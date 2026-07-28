'use client';

/**
 * ปรับปรุงสต็อกสินค้า (ลด) — เอกสาร IS (trans_flag=68, calc_flag=−1)
 *
 * ต่างจาก BulkStockAdjustForm (IA) ตรงที่เป็นการ **ตัดสต็อกออกจริง**:
 *   - Excel ระบุ "จำนวนที่ลด" รวม (ไม่ระบุคลัง/ที่เก็บ)
 *   - หน้าจอไล่ตัดจากที่เก็บที่ **มีของมากสุดก่อน** จนครบจำนวน
 *   - ทุน/หน่วยดึงจากทุนเฉลี่ยปัจจุบันของแต่ละที่เก็บอัตโนมัติ (ไม่ให้กรอก)
 *   - ถ้าคงเหลือรวมทุกที่เก็บไม่พอ → error ทั้งแถว ไม่ตัดบางส่วน
 *   - 1 ใบเอกสารต่อ (คลัง, ที่เก็บ) เหมือนหน้า IA
 *
 * ── หน่วยนับ ──
 * `location.stock_qty` และ `location.old_cost` จาก API อยู่ในหน่วย **unit_standard**
 * ส่วน user กรอกจำนวนในหน่วยที่เลือก จึงคำนวณโดยแปลงเข้า unit_standard ก่อนเสมอ:
 *   ratio      = stand_value / divide_value ของหน่วยที่เลือก
 *   qty_std    = จำนวนที่กรอก × ratio
 *   unit_cost  = old_cost × ratio        (ทุนต่อ 1 หน่วยที่เลือก)
 *   sum_amount = qty_unit × unit_cost = qty_std × old_cost  ✓
 * ค่าที่ส่งลง DB เป็นหน่วยที่เลือก (qty, price) แล้ว SML คูณ stand/divide กลับเอง
 */

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import {
  Save,
  TrendingDown,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Download,
  Upload,
  FileSpreadsheet,
  Search,
  Plus,
} from 'lucide-react';
import {
  getErpOption,
  getItemLocations,
  saveStockAdjustReduce,
  type ItemLocation,
  type ItemOption,
  type UnitOption,
} from '@/actions/stock-adjust';
import {
  downloadReduceTemplate,
  parseReduceImportFile,
  type ReduceImportRow,
} from '@/lib/excel';
import DateInputDDMMYYYY from '@/components/ui/DateInputDDMMYYYY';
import ItemPickerModal from './ItemPickerModal';
import {
  Field,
  LoadProgressBar,
  SaveProgressLine,
  formatAmount,
  formatMoney,
  inputClass,
  nowHHMM,
  todayISO,
} from './bulkShared';
import {
  allocateReduce,
  roundQty,
  totalAvailable,
} from '@/lib/stock-reduce-allocate';

/** 1 แถวใน preview = 1 (item × ที่เก็บ) ที่ระบบจัดสรรจำนวนให้แล้ว */
interface PreviewRow {
  key: number;
  row_index: number; // ลำดับใน Excel (-1 = เพิ่มเอง)
  item_code: string;
  item_name: string;
  unit_code: string;
  unit_standard: string;
  stand_value: number;
  divide_value: number;
  wh_code: string;
  wh_name: string;
  shelf_code: string;
  shelf_name: string;
  /** คงเหลือของที่เก็บนี้ — หน่วยที่เลือก */
  available_qty: number;
  /** จำนวนที่จะตัดจากที่เก็บนี้ — หน่วยที่เลือก (user แก้ได้) */
  reduce_qty: number;
  /** ทุนเฉลี่ยปัจจุบัน — ต่อ 1 หน่วยที่เลือก */
  unit_cost: number;
  checked: boolean;
}

interface ItemResult {
  row_index: number;
  item_code: string;
  status: 'error' | 'ok';
  error?: string;
  item_name?: string;
  /** จำนวนที่เก็บที่ถูกใช้ตัด */
  location_count?: number;
}

interface DocGroup {
  wh_code: string;
  wh_name: string;
  shelf_code: string;
  shelf_name: string;
  rows: PreviewRow[];
}

interface SaveOutcome {
  wh_code: string;
  shelf_code: string;
  line_count: number;
  total_amount: number;
  success: boolean;
  doc_no?: string;
  message?: string;
}

let rowCounter = 0;
const nextKey = () => ++rowCounter;

/** stand/divide ของหน่วยที่เลือก — 1 หน่วยนี้ = ratio unit_standard */
function unitRatio(u: Pick<UnitOption, 'stand_value' | 'divide_value'>): number {
  return (u.stand_value || 1) / (u.divide_value || 1) || 1;
}

function rowSumAmount(r: PreviewRow): number {
  return r.reduce_qty * r.unit_cost;
}

function groupByWhShelf(rows: PreviewRow[]): DocGroup[] {
  const map = new Map<string, DocGroup>();
  for (const r of rows) {
    const key = `${r.wh_code}|${r.shelf_code}`;
    let g = map.get(key);
    if (!g) {
      g = {
        wh_code: r.wh_code,
        wh_name: r.wh_name,
        shelf_code: r.shelf_code,
        shelf_name: r.shelf_name,
        rows: [],
      };
      map.set(key, g);
    }
    g.rows.push(r);
  }
  return Array.from(map.values());
}

export default function BulkStockReduceForm() {
  // ── Header ──
  const [docDate, setDocDate] = useState<string>(todayISO());
  const [docTime, setDocTime] = useState<string>(nowHHMM());
  const [docRef, setDocRef] = useState<string>('');
  const [docRefDate, setDocRefDate] = useState<string>('');
  const [remark, setRemark] = useState<string>('');

  // ── Import + preview ──
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [itemResults, setItemResults] = useState<ItemResult[]>([]);
  const [importMsg, setImportMsg] = useState<{
    kind: 'info' | 'warn' | 'error';
    text: string;
  } | null>(null);
  const [loadProgress, setLoadProgress] = useState<{
    done: number;
    total: number;
    startedAt: number;
  } | null>(null);
  const [isImporting, startImporting] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Manual item picker ──
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerKey, setPickerKey] = useState(0);
  const [pickerData, setPickerData] = useState<{
    item: ItemOption;
    units: UnitOption[];
    locations: ItemLocation[];
  } | null>(null);
  const [pickerUnitCode, setPickerUnitCode] = useState<string>('');
  const [pickerQty, setPickerQty] = useState<number>(0);
  const [isPickerLoading, startPickerLoading] = useTransition();
  const [isAdding, startAdding] = useTransition();

  // ── ERP options (decimal display) ──
  const [amountDecimal, setAmountDecimal] = useState<number>(2);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const opt = await getErpOption();
        if (cancelled) return;
        setAmountDecimal(opt.item_amount_decimal);
      } catch {
        /* fallback 2 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Save ──
  const [outcomes, setOutcomes] = useState<SaveOutcome[]>([]);
  const [saveProgress, setSaveProgress] = useState<{
    done: number;
    total: number;
    startedAt: number;
  } | null>(null);
  const [isSaving, startSaving] = useTransition();

  // ── Derived ──
  const checkedRows = useMemo(
    () => rows.filter((r) => r.checked && r.reduce_qty > 0),
    [rows],
  );
  const docGroups = useMemo(() => groupByWhShelf(checkedRows), [checkedRows]);
  const totalAmount = useMemo(
    () => checkedRows.reduce((s, r) => s + rowSumAmount(r), 0),
    [checkedRows],
  );

  /** จำนวนแถวใน preview ของ item ที่ picker เพิ่งเลือก */
  const pickerExistingCount = useMemo(() => {
    if (!pickerData) return 0;
    return rows.filter((r) => r.item_code === pickerData.item.code).length;
  }, [pickerData, rows]);

  /** แถวที่ user แก้จำนวนจนเกินคงเหลือ — กันไว้ก่อนกดบันทึก */
  const overCount = useMemo(
    () => rows.filter((r) => r.checked && r.reduce_qty > r.available_qty).length,
    [rows],
  );

  function resetImport() {
    setRows([]);
    setItemResults([]);
    setImportMsg(null);
    setLoadProgress(null);
    setOutcomes([]);
    setSaveProgress(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  // ── Excel upload handler ──
  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    resetImport();

    let parsed: { rows: ReduceImportRow[]; warning?: string };
    try {
      parsed = await parseReduceImportFile(file);
    } catch (err: unknown) {
      setImportMsg({
        kind: 'error',
        text: err instanceof Error ? err.message : 'อ่านไฟล์ผิดพลาด',
      });
      return;
    }

    // dedupe by item_code — ใช้แถวล่าสุด
    const dedup = new Map<string, ReduceImportRow>();
    const dupSet = new Set<string>();
    for (const r of parsed.rows) {
      const code = r.item_code.trim();
      if (!code) {
        dedup.set(`__empty_${r.row_index}`, r);
        continue;
      }
      if (dedup.has(code)) dupSet.add(code);
      dedup.set(code, r);
    }

    startImporting(async () => {
      await processRows(Array.from(dedup.values()), dupSet, parsed.warning);
    });
  }

  async function processRows(
    importRows: ReduceImportRow[],
    duplicates: Set<string>,
    parseWarning?: string,
  ) {
    const startedAt = Date.now();
    setLoadProgress({ done: 0, total: importRows.length, startedAt });
    const results: ItemResult[] = [];
    const preview: PreviewRow[] = [];

    const BATCH = 5;
    for (let i = 0; i < importRows.length; i += BATCH) {
      const slice = importRows.slice(i, i + BATCH);
      await Promise.all(
        slice.map(async (r) => {
          const itemCode = (r.item_code || '').trim();
          const unitCode = (r.unit_code || '').trim();
          const wantQty = Number(r.reduce_qty);

          if (!itemCode) {
            results.push({
              row_index: r.row_index,
              item_code: itemCode,
              status: 'error',
              error: 'รหัสสินค้าว่าง',
            });
            return;
          }
          if (!unitCode) {
            results.push({
              row_index: r.row_index,
              item_code: itemCode,
              status: 'error',
              error: 'หน่วยว่าง',
            });
            return;
          }
          if (!Number.isFinite(wantQty)) {
            results.push({
              row_index: r.row_index,
              item_code: itemCode,
              status: 'error',
              error: 'จำนวนผิด format',
            });
            return;
          }
          if (wantQty <= 0) {
            results.push({
              row_index: r.row_index,
              item_code: itemCode,
              status: 'error',
              error: 'จำนวนที่ลดต้องมากกว่า 0',
            });
            return;
          }

          const res = await getItemLocations(itemCode);
          if (!res.success) {
            results.push({
              row_index: r.row_index,
              item_code: itemCode,
              status: 'error',
              error: res.message || 'โหลดที่เก็บไม่สำเร็จ',
            });
            return;
          }
          if (!res.item) {
            results.push({
              row_index: r.row_index,
              item_code: itemCode,
              status: 'error',
              error: 'ไม่พบรหัสสินค้า',
            });
            return;
          }

          const unit = (res.units || []).find((u) => u.code === unitCode);
          if (!unit) {
            results.push({
              row_index: r.row_index,
              item_code: itemCode,
              status: 'error',
              item_name: res.item.name,
              error: `หน่วย "${unitCode}" ไม่ตรงกับสินค้า`,
            });
            return;
          }

          const ratio = unitRatio(unit);
          const allocations = allocateReduce(wantQty * ratio, res.locations);
          if (!allocations) {
            const totalStd = totalAvailable(res.locations);
            results.push({
              row_index: r.row_index,
              item_code: itemCode,
              status: 'error',
              item_name: res.item.name,
              error: `คงเหลือรวมไม่พอ — มี ${formatMoney(totalStd / ratio)} ${unitCode} แต่ขอตัด ${formatMoney(wantQty)} ${unitCode}`,
            });
            return;
          }

          results.push({
            row_index: r.row_index,
            item_code: itemCode,
            status: 'ok',
            item_name: res.item.name,
            location_count: allocations.length,
          });

          const unitStd = res.item.unit_standard || unit.code;
          for (const a of allocations) {
            preview.push({
              key: nextKey(),
              row_index: r.row_index,
              item_code: itemCode,
              item_name: res.item.name,
              unit_code: unit.code,
              unit_standard: unitStd,
              stand_value: unit.stand_value,
              divide_value: unit.divide_value,
              wh_code: a.loc.wh_code,
              wh_name: a.loc.wh_name,
              shelf_code: a.loc.shelf_code,
              shelf_name: a.loc.shelf_name,
              available_qty: roundQty(a.loc.stock_qty / ratio),
              reduce_qty: roundQty(a.qty_std / ratio),
              unit_cost: a.loc.old_cost * ratio,
              checked: true,
            });
          }
        }),
      );
      setLoadProgress({
        done: Math.min(i + BATCH, importRows.length),
        total: importRows.length,
        startedAt,
      });
    }

    preview.sort(
      (a, b) =>
        a.wh_code.localeCompare(b.wh_code) ||
        a.shelf_code.localeCompare(b.shelf_code) ||
        a.item_code.localeCompare(b.item_code),
    );
    results.sort((a, b) => a.row_index - b.row_index);

    setRows(preview);
    setItemResults(results);
    setLoadProgress(null);

    const groupCount = new Set(
      preview.map((r) => `${r.wh_code}|${r.shelf_code}`),
    ).size;
    const errorCount = results.filter((r) => r.status === 'error').length;
    const okCount = results.filter((r) => r.status === 'ok').length;

    const parts: string[] = [];
    parts.push(`อ่าน ${importRows.length} item`);
    parts.push(`✓ ${okCount}`);
    if (errorCount > 0) parts.push(`✗ ${errorCount} error`);
    parts.push(`preview ${preview.length} แถว ใน ${groupCount} ใบ`);

    const extras: string[] = [];
    if (duplicates.size > 0) {
      extras.push(`item ซ้ำ ${duplicates.size} รหัส (ใช้แถวสุดท้าย)`);
    }
    if (parseWarning) extras.push(parseWarning);

    setImportMsg({
      kind: errorCount > 0 || extras.length > 0 ? 'warn' : 'info',
      text: parts.join(' — ') + (extras.length ? ` | ${extras.join(' | ')}` : ''),
    });
  }

  function toggleRow(key: number) {
    setRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, checked: !r.checked } : r)),
    );
  }

  function toggleAll(check: boolean) {
    setRows((prev) => prev.map((r) => ({ ...r, checked: check })));
  }

  function toggleGroup(whCode: string, shelfCode: string, check: boolean) {
    setRows((prev) =>
      prev.map((r) =>
        r.wh_code === whCode && r.shelf_code === shelfCode
          ? { ...r, checked: check }
          : r,
      ),
    );
  }

  function setRowQty(key: number, qty: number) {
    setRows((prev) =>
      prev.map((r) =>
        r.key === key ? { ...r, reduce_qty: Number.isFinite(qty) ? qty : 0 } : r,
      ),
    );
  }

  // ── Manual picker handlers ──
  function openItemPicker() {
    setPickerKey((k) => k + 1);
    setPickerOpen(true);
  }

  function onPickItem(item: ItemOption) {
    setPickerData(null);
    setPickerUnitCode(item.unit_standard);
    setPickerQty(0);
    setImportMsg(null);
    startPickerLoading(async () => {
      const res = await getItemLocations(item.code);
      if (!res.success || !res.item) {
        setImportMsg({
          kind: 'error',
          text: res.message || 'ดึงข้อมูลสินค้าไม่สำเร็จ',
        });
        return;
      }
      const units =
        res.units && res.units.length > 0
          ? res.units
          : [
              {
                code: res.item.unit_standard,
                stand_value: 1,
                divide_value: 1,
                ratio: 1,
              },
            ];
      setPickerData({ item: res.item, units, locations: res.locations });
      setPickerUnitCode(res.item.unit_standard || units[0].code);
    });
  }

  function addManualItem() {
    if (!pickerData) return;
    const unit = pickerData.units.find((u) => u.code === pickerUnitCode);
    if (!unit) {
      setImportMsg({ kind: 'error', text: 'หน่วยไม่ถูกต้อง' });
      return;
    }
    if (!Number.isFinite(pickerQty) || pickerQty <= 0) {
      setImportMsg({ kind: 'error', text: 'กรุณากรอกจำนวนที่ลด (> 0)' });
      return;
    }

    startAdding(() => {
      const ratio = unitRatio(unit);
      const allocations = allocateReduce(pickerQty * ratio, pickerData.locations);
      if (!allocations) {
        const totalStd = totalAvailable(pickerData.locations);
        setImportMsg({
          kind: 'error',
          text: `${pickerData.item.code} — คงเหลือรวมไม่พอ มี ${formatMoney(totalStd / ratio)} ${unit.code} แต่ขอตัด ${formatMoney(pickerQty)} ${unit.code}`,
        });
        return;
      }

      const unitStd = pickerData.item.unit_standard || unit.code;
      const newRows: PreviewRow[] = allocations.map((a) => ({
        key: nextKey(),
        row_index: -1,
        item_code: pickerData.item.code,
        item_name: pickerData.item.name,
        unit_code: unit.code,
        unit_standard: unitStd,
        stand_value: unit.stand_value,
        divide_value: unit.divide_value,
        wh_code: a.loc.wh_code,
        wh_name: a.loc.wh_name,
        shelf_code: a.loc.shelf_code,
        shelf_name: a.loc.shelf_name,
        available_qty: roundQty(a.loc.stock_qty / ratio),
        reduce_qty: roundQty(a.qty_std / ratio),
        unit_cost: a.loc.old_cost * ratio,
        checked: true,
      }));

      // dedupe: ลบแถวเก่าของ item นี้ออกก่อน (replace by latest)
      const code = pickerData.item.code;
      const replaced = rows.some((r) => r.item_code === code);
      const others = rows.filter((r) => r.item_code !== code);
      setRows(
        [...others, ...newRows].sort(
          (a, b) =>
            a.wh_code.localeCompare(b.wh_code) ||
            a.shelf_code.localeCompare(b.shelf_code) ||
            a.item_code.localeCompare(b.item_code),
        ),
      );

      setItemResults((prev) => [
        ...prev.filter((r) => r.item_code !== code),
        {
          row_index: 0,
          item_code: code,
          status: 'ok',
          item_name: pickerData.item.name,
          location_count: newRows.length,
        },
      ]);

      setImportMsg({
        kind: 'info',
        text: replaced
          ? `${code} — แทนแถวเก่า (ตัดจาก ${newRows.length} ที่เก็บ)`
          : `+ ${code} (ตัดจาก ${newRows.length} ที่เก็บ)`,
      });

      setPickerData(null);
      setPickerQty(0);
    });
  }

  function onSave() {
    if (docGroups.length === 0) {
      setImportMsg({ kind: 'error', text: 'กรุณาเลือกอย่างน้อย 1 แถว' });
      return;
    }
    if (overCount > 0) {
      setImportMsg({
        kind: 'error',
        text: `มี ${overCount} แถวที่จำนวนเกินคงเหลือ — แก้ก่อนบันทึก`,
      });
      return;
    }

    setOutcomes([]);
    const saveStartedAt = Date.now();
    setSaveProgress({ done: 0, total: docGroups.length, startedAt: saveStartedAt });
    setImportMsg(null);

    startSaving(async () => {
      const results: SaveOutcome[] = [];
      for (let i = 0; i < docGroups.length; i++) {
        const g = docGroups[i];
        const lines = g.rows.map((r) => ({
          item_code: r.item_code,
          item_name: r.item_name,
          unit_code: r.unit_code,
          qty: r.reduce_qty,
          price: r.unit_cost,
          sum_amount: rowSumAmount(r),
          wh_code: r.wh_code,
          shelf_code: r.shelf_code,
          stand_value: r.stand_value,
          divide_value: r.divide_value,
        }));
        const groupTotal = lines.reduce((s, l) => s + l.sum_amount, 0);

        const res = await saveStockAdjustReduce({
          doc_date: docDate,
          doc_time: docTime,
          doc_ref: docRef,
          doc_ref_date: docRefDate,
          wh_from: g.wh_code,
          location_from: g.shelf_code,
          remark,
          lines,
        });

        results.push({
          wh_code: g.wh_code,
          shelf_code: g.shelf_code,
          line_count: lines.length,
          total_amount: groupTotal,
          success: res.success,
          doc_no: res.doc_no,
          message: res.message,
        });
        setOutcomes([...results]);
        setSaveProgress({
          done: i + 1,
          total: docGroups.length,
          startedAt: saveStartedAt,
        });
      }
    });
  }

  const successCount = outcomes.filter((o) => o.success).length;
  const failCount = outcomes.filter((o) => !o.success).length;
  const allSaveDone =
    saveProgress !== null &&
    saveProgress.done === saveProgress.total &&
    !isSaving;

  return (
    <div className="space-y-4">
      {/* ── Header ── */}
      <div className="rounded-xl bg-white p-4 shadow-sm">
        <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-gray-800">
          <TrendingDown className="h-5 w-5 text-purple-600" />
          ปรับปรุงสต็อกสินค้า (ลด) — ตัดสต็อกออก — เอกสาร IS
        </h2>

        <div className="mb-3 flex items-start gap-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          <span>
            เมนูนี้ <b>ตัดจำนวนสินค้าออกจากสต็อกจริง</b> — ระบุจำนวนรวมที่ต้องการลด
            ระบบจะไล่ตัดจากที่เก็บที่<b>มีของมากที่สุดก่อน</b>จนครบ
            โดยใช้ทุนเฉลี่ยปัจจุบันของแต่ละที่เก็บ (ทุนเฉลี่ยหลังตัดไม่เปลี่ยน)
            <br />
            ถ้าต้องการแค่ปรับทุนโดยไม่แตะจำนวน ให้ใช้เมนู
            &ldquo;ปรับต้นทุนทุกที่เก็บ&rdquo;
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label="วันที่เอกสาร *">
            <DateInputDDMMYYYY
              value={docDate}
              onChange={setDocDate}
              className={inputClass}
            />
          </Field>
          <Field label="เวลา">
            <input
              type="time"
              value={docTime}
              onChange={(e) => setDocTime(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="ประเภทรายการ">
            <input
              disabled
              value="1.ปรับปรุงสินค้า"
              className={`${inputClass} bg-gray-100 text-gray-600`}
            />
          </Field>
          <Field label="เอกสารอ้างอิง">
            <input
              value={docRef}
              onChange={(e) => setDocRef(e.target.value)}
              maxLength={255}
              className={inputClass}
            />
          </Field>
          <Field label="วันที่อ้างอิง">
            <DateInputDDMMYYYY
              value={docRefDate}
              onChange={setDocRefDate}
              className={inputClass}
            />
          </Field>
          <Field label="หมายเหตุ" className="md:col-span-3">
            <input
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              maxLength={255}
              className={inputClass}
            />
          </Field>
        </div>
      </div>

      {/* ── Import bar ── */}
      <div className="rounded-xl bg-white p-4 shadow-sm">
        <h3 className="mb-3 flex items-center gap-2 text-base font-semibold text-gray-800">
          <FileSpreadsheet className="h-5 w-5 text-purple-600" />
          Import จาก Excel/CSV/TSV
        </h3>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={downloadReduceTemplate}
            className="flex items-center gap-2 rounded-lg border border-purple-300 bg-white px-3 py-2 text-sm font-medium text-purple-700 hover:bg-purple-50"
          >
            <Download className="h-4 w-4" />
            ดาวน์โหลด Template
          </button>

          <label className="flex cursor-pointer items-center gap-2 rounded-lg bg-purple-600 px-3 py-2 text-sm font-medium text-white hover:bg-purple-700">
            <Upload className="h-4 w-4" />
            เลือกไฟล์ (Excel/CSV/TSV)
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.csv,.tsv,.txt"
              onChange={handleFile}
              className="hidden"
              disabled={isImporting || isSaving}
            />
          </label>

          {rows.length > 0 && !isImporting && (
            <button
              type="button"
              onClick={resetImport}
              className="text-sm text-gray-600 underline hover:text-gray-900"
            >
              เริ่มใหม่
            </button>
          )}

          <div className="ml-auto text-xs text-gray-500">
            Template format: <code>รหัสสินค้า | หน่วยนับ | จำนวนที่ลด</code>
          </div>
        </div>

        {loadProgress && (
          <LoadProgressBar
            done={loadProgress.done}
            total={loadProgress.total}
            startedAt={loadProgress.startedAt}
          />
        )}

        {importMsg && (
          <div
            className={`mt-3 rounded-lg p-2 text-sm ${
              importMsg.kind === 'error'
                ? 'bg-red-50 text-red-700'
                : importMsg.kind === 'warn'
                  ? 'bg-amber-50 text-amber-800'
                  : 'bg-blue-50 text-blue-700'
            }`}
          >
            {importMsg.text}
          </div>
        )}

        {/* ── Divider + manual picker ── */}
        <div className="mt-4 flex items-center gap-3 text-xs text-gray-400">
          <div className="flex-1 border-t border-gray-200" />
          <span>หรือเลือกสินค้าเองทีละตัว</span>
          <div className="flex-1 border-t border-gray-200" />
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-12">
          <Field label="สินค้า" className="md:col-span-6">
            <div className="flex gap-1">
              <input
                readOnly
                value={
                  isPickerLoading
                    ? 'กำลังโหลด...'
                    : pickerData
                      ? `${pickerData.item.code} — ${pickerData.item.name}`
                      : 'ยังไม่ได้เลือก'
                }
                onClick={openItemPicker}
                className={`${inputClass} flex-1 cursor-pointer bg-gray-50`}
              />
              <button
                type="button"
                onClick={openItemPicker}
                disabled={isImporting || isSaving}
                className="rounded-lg border border-purple-300 bg-white px-3 text-purple-600 hover:bg-purple-50 disabled:cursor-not-allowed disabled:opacity-50"
                title="ค้นหาสินค้า"
              >
                <Search className="h-4 w-4" />
              </button>
            </div>
          </Field>

          <Field label="หน่วย" className="md:col-span-2">
            <select
              value={pickerUnitCode}
              onChange={(e) => setPickerUnitCode(e.target.value)}
              disabled={!pickerData}
              className={inputClass}
            >
              {!pickerData && <option value="">-</option>}
              {pickerData?.units.map((u) => (
                <option key={u.code} value={u.code}>
                  {u.code} ({u.ratio || u.stand_value / u.divide_value})
                </option>
              ))}
            </select>
          </Field>

          <Field label="จำนวนที่ลด" className="md:col-span-2">
            <input
              type="number"
              step="0.00001"
              min="0"
              value={pickerQty}
              onChange={(e) => setPickerQty(Number(e.target.value) || 0)}
              disabled={!pickerData}
              className={`${inputClass} text-right`}
            />
          </Field>

          <div className="flex items-end md:col-span-2">
            <button
              type="button"
              onClick={addManualItem}
              disabled={!pickerData || isAdding || pickerQty <= 0}
              className={`flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-gray-300 ${
                pickerExistingCount > 0
                  ? 'bg-amber-600 hover:bg-amber-700'
                  : 'bg-purple-600 hover:bg-purple-700'
              }`}
              title={
                !pickerData
                  ? 'เลือกสินค้าก่อน'
                  : pickerExistingCount > 0
                    ? `แทน ${pickerExistingCount} แถวเดิมของ ${pickerData.item.code}`
                    : 'เพิ่มเข้า preview'
              }
            >
              <Plus className="h-4 w-4" />
              {isAdding
                ? 'กำลังเพิ่ม...'
                : pickerExistingCount > 0
                  ? 'แทนแถวเดิม'
                  : 'เพิ่มเข้า preview'}
            </button>
          </div>

          {pickerData && pickerExistingCount > 0 && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800 md:col-span-12">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              <span>
                <b>{pickerData.item.code}</b> มีอยู่ใน preview แล้ว{' '}
                <b>{pickerExistingCount}</b> แถว — กดเพิ่มจะ
                <b>แทนทุกแถวเดิม</b>ด้วยค่าใหม่
              </span>
            </div>
          )}

          {pickerData && (
            <div className="text-xs text-gray-500 md:col-span-12">
              {(() => {
                const unit = pickerData.units.find(
                  (u) => u.code === pickerUnitCode,
                );
                const ratio = unit ? unitRatio(unit) : 1;
                const positive = pickerData.locations.filter(
                  (l) => l.stock_qty > 0,
                );
                const totalStd = totalAvailable(pickerData.locations);
                return `พบ ${positive.length} ที่เก็บที่มีของ — คงเหลือรวม ${formatMoney(totalStd / ratio)} ${pickerUnitCode || ''}`;
              })()}
            </div>
          )}
        </div>
      </div>

      {/* ── Item-level errors ── */}
      {itemResults.some((r) => r.status !== 'ok') && (
        <div className="rounded-xl bg-white p-4 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold text-gray-700">
            รายการที่ข้าม / ผิดพลาด
          </h3>
          <div className="space-y-1 text-sm">
            {itemResults
              .filter((r) => r.status !== 'ok')
              .map((r) => (
                <div
                  key={`${r.row_index}-${r.item_code}`}
                  className="flex items-start gap-2"
                >
                  <XCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600" />
                  <span className="text-gray-400">row {r.row_index}</span>
                  <span className="font-mono text-xs">
                    {r.item_code || '(ว่าง)'}
                  </span>
                  {r.item_name && (
                    <span className="text-gray-700">{r.item_name}</span>
                  )}
                  <span className="text-red-700">{r.error}</span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* ── Preview table grouped by (wh, shelf) ── */}
      {rows.length > 0 && (
        <div className="rounded-xl bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-base font-semibold text-gray-800">
              Preview — {rows.length} แถว ใน {docGroups.length} ใบ (เลือก{' '}
              {checkedRows.length})
            </h3>
            <div className="flex items-center gap-2 text-xs">
              <button
                type="button"
                onClick={() => toggleAll(true)}
                className="rounded border border-gray-300 px-2 py-1 hover:bg-gray-50"
              >
                เลือกทั้งหมด
              </button>
              <button
                type="button"
                onClick={() => toggleAll(false)}
                className="rounded border border-gray-300 px-2 py-1 hover:bg-gray-50"
              >
                ล้าง
              </button>
            </div>
          </div>

          {overCount > 0 && (
            <div className="mb-3 flex items-start gap-2 rounded-lg bg-red-50 p-2 text-sm text-red-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>
                มี <b>{overCount}</b> แถวที่จำนวนที่ลดเกินคงเหลือ — บันทึกไม่ได้
                จนกว่าจะแก้
              </span>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-600">
                <tr>
                  <th className="w-10 px-2 py-2 text-center"></th>
                  <th className="px-2 py-2 text-left">คลัง</th>
                  <th className="px-2 py-2 text-left">พื้นที่</th>
                  <th className="px-2 py-2 text-left">สินค้า</th>
                  <th className="px-2 py-2 text-left">หน่วย</th>
                  <th className="px-2 py-2 text-right">คงเหลือ</th>
                  <th className="px-2 py-2 text-right">จำนวนที่ลด</th>
                  <th className="px-2 py-2 text-right">ทุน/หน่วย</th>
                  <th className="px-2 py-2 text-right">มูลค่าที่ลด</th>
                </tr>
              </thead>
              <tbody>
                {docGroups.map((g, gi) => {
                  const groupSum = g.rows.reduce(
                    (s, r) => s + rowSumAmount(r),
                    0,
                  );
                  return (
                    <GroupBlock
                      key={`${g.wh_code}|${g.shelf_code}`}
                      group={g}
                      docNumber={gi + 1}
                      groupSum={groupSum}
                      amountDecimal={amountDecimal}
                      onToggleRow={toggleRow}
                      onChangeQty={setRowQty}
                      onToggleGroup={(check) =>
                        toggleGroup(g.wh_code, g.shelf_code, check)
                      }
                    />
                  );
                })}
              </tbody>
              <tfoot className="bg-gray-50">
                <tr>
                  <td
                    colSpan={8}
                    className="px-2 py-2 text-right font-semibold text-gray-700"
                  >
                    รวมมูลค่าที่ลด ({docGroups.length} ใบ)
                  </td>
                  <td className="px-2 py-2 text-right text-lg font-bold text-purple-700 tabular-nums">
                    {formatAmount(totalAmount, amountDecimal)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* ── Save + outcomes ── */}
      {rows.length > 0 && (
        <div className="rounded-xl bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1 text-sm">
              {saveProgress && (
                <div className="space-y-1">
                  <div>
                    <SaveProgressLine
                      done={saveProgress.done}
                      total={saveProgress.total}
                      startedAt={saveProgress.startedAt}
                      allDone={allSaveDone}
                      successCount={successCount}
                      failCount={failCount}
                    />
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
                    <div
                      className="h-full bg-purple-600 transition-all"
                      style={{
                        width: `${(saveProgress.done / saveProgress.total) * 100}%`,
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
            <button
              type="button"
              disabled={isSaving || docGroups.length === 0 || overCount > 0}
              onClick={onSave}
              className="flex items-center gap-2 rounded-lg bg-green-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              <Save className="h-4 w-4" />
              {isSaving ? 'กำลังบันทึก...' : `บันทึก ${docGroups.length} ใบ`}
            </button>
          </div>

          {outcomes.length > 0 && (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-600">
                  <tr>
                    <th className="w-8 px-2 py-2"></th>
                    <th className="px-2 py-2 text-left">คลัง</th>
                    <th className="px-2 py-2 text-left">พื้นที่</th>
                    <th className="px-2 py-2 text-right">lines</th>
                    <th className="px-2 py-2 text-right">มูลค่า</th>
                    <th className="px-2 py-2 text-left">เลขที่เอกสาร / ข้อความ</th>
                  </tr>
                </thead>
                <tbody>
                  {outcomes.map((o, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-2 py-1 text-center">
                        {o.success ? (
                          <CheckCircle2 className="inline h-4 w-4 text-green-600" />
                        ) : (
                          <XCircle className="inline h-4 w-4 text-red-600" />
                        )}
                      </td>
                      <td className="px-2 py-1 font-mono text-xs">{o.wh_code}</td>
                      <td className="px-2 py-1 font-mono text-xs">
                        {o.shelf_code}
                      </td>
                      <td className="px-2 py-1 text-right text-gray-600">
                        {o.line_count}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums">
                        {formatAmount(o.total_amount, amountDecimal)}
                      </td>
                      <td className="px-2 py-1">
                        {o.success ? (
                          <span className="font-mono text-xs text-green-700">
                            {o.doc_no}
                          </span>
                        ) : (
                          <span className="text-xs text-red-700">{o.message}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <ItemPickerModal
        key={`picker-${pickerKey}`}
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={onPickItem}
      />
    </div>
  );
}

// ──────────────────────────── Subcomponents ────────────────────────────

interface GroupBlockProps {
  group: DocGroup;
  docNumber: number;
  groupSum: number;
  amountDecimal: number;
  onToggleRow: (key: number) => void;
  onChangeQty: (key: number, qty: number) => void;
  onToggleGroup: (check: boolean) => void;
}

function GroupBlock({
  group,
  docNumber,
  groupSum,
  amountDecimal,
  onToggleRow,
  onChangeQty,
  onToggleGroup,
}: GroupBlockProps) {
  const allChecked = group.rows.every((r) => r.checked);
  const someChecked = group.rows.some((r) => r.checked);

  return (
    <>
      <tr className="border-t-2 border-purple-200 bg-purple-50/40">
        <td className="px-2 py-1 text-center">
          <input
            type="checkbox"
            checked={allChecked}
            ref={(el) => {
              if (el) el.indeterminate = someChecked && !allChecked;
            }}
            onChange={() => onToggleGroup(!allChecked)}
            className="h-4 w-4 cursor-pointer accent-purple-600"
          />
        </td>
        <td
          colSpan={8}
          className="px-2 py-1 text-xs font-semibold text-purple-900"
        >
          📄 ใบที่ {docNumber}: {group.wh_code}
          {group.wh_name ? ` (${group.wh_name})` : ''} — {group.shelf_code}
          {group.shelf_name ? ` (${group.shelf_name})` : ''} · {group.rows.length}{' '}
          lines · รวม{' '}
          <span className="tabular-nums text-purple-700">
            {formatAmount(groupSum, amountDecimal)}
          </span>
        </td>
      </tr>
      {group.rows.map((r) => {
        const over = r.reduce_qty > r.available_qty;
        return (
          <tr key={r.key} className="border-t">
            <td className="px-2 py-1 text-center">
              <input
                type="checkbox"
                checked={r.checked}
                onChange={() => onToggleRow(r.key)}
                className="h-4 w-4 cursor-pointer accent-purple-600"
              />
            </td>
            <td className="px-2 py-1 font-mono text-xs">{r.wh_code}</td>
            <td className="px-2 py-1 font-mono text-xs">{r.shelf_code}</td>
            <td className="px-2 py-1">
              <div className="font-mono text-xs">{r.item_code}</div>
              <div className="text-xs text-gray-600">{r.item_name}</div>
            </td>
            <td className="px-2 py-1 text-xs">{r.unit_code}</td>
            <td className="px-2 py-1 text-right text-xs tabular-nums">
              {formatMoney(r.available_qty)} {r.unit_code}
            </td>
            <td className="px-2 py-1 text-right">
              <input
                type="number"
                step="0.00001"
                min="0"
                max={r.available_qty}
                value={r.reduce_qty}
                onChange={(e) => onChangeQty(r.key, Number(e.target.value))}
                className={`w-24 rounded border px-2 py-1 text-right text-xs tabular-nums focus:outline-none focus:ring-1 ${
                  over
                    ? 'border-red-400 bg-red-50 text-red-700 focus:ring-red-400'
                    : 'border-gray-300 focus:border-purple-500 focus:ring-purple-500'
                }`}
              />
            </td>
            <td className="px-2 py-1 text-right text-xs tabular-nums">
              {formatMoney(r.unit_cost)}
            </td>
            <td className="px-2 py-1 text-right font-medium tabular-nums">
              {formatAmount(rowSumAmount(r), amountDecimal)}
            </td>
          </tr>
        );
      })}
    </>
  );
}
