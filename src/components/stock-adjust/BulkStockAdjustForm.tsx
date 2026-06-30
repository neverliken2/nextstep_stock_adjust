'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import {
  Save,
  Layers,
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
  saveStockAdjust,
  type ItemLocation,
  type ItemOption,
  type UnitOption,
} from '@/actions/stock-adjust';
import { downloadTemplate, parseExcel, type ImportRow } from '@/lib/excel';
import DateInputDDMMYYYY from '@/components/ui/DateInputDDMMYYYY';
import ItemPickerModal from './ItemPickerModal';

/** 1 แถวใน preview = 1 (item × location) — N แถวที่ wh+shelf เดียวกันจะรวมเป็น 1 ใบเอกสาร */
interface PreviewRow {
  key: number;
  row_index: number; // ลำดับใน Excel (debug/error reference)
  item_code: string;
  item_name: string;
  unit_code: string;
  unit_standard: string;
  new_cost: number;
  stand_value: number;
  divide_value: number;
  wh_code: string;
  wh_name: string;
  shelf_code: string;
  shelf_name: string;
  stock_qty: number; // ใน unit_standard
  old_cost: number;
  checked: boolean;
}

/** Item-level result (สำหรับ error display + sanity) */
interface ItemResult {
  row_index: number;
  item_code: string;
  status: 'error' | 'no-locations' | 'ok';
  error?: string;
  item_name?: string;
  /** จำนวน location ที่ skip เพราะ stock_qty ≤ 0 */
  skipped_zero?: number;
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

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function nowHHMM(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatMoney(n: number): string {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 5,
  });
}

function formatAmount(n: number, decimal: number): string {
  if (!Number.isFinite(n)) return '-';
  return n.toLocaleString(undefined, {
    minimumFractionDigits: decimal,
    maximumFractionDigits: decimal,
  });
}

function rowQty(r: PreviewRow): number {
  const ratio = (r.stand_value || 1) / (r.divide_value || 1);
  return r.stock_qty / (ratio || 1);
}

function rowSumAmount(r: PreviewRow): number {
  return (Number(r.new_cost) - Number(r.old_cost)) * rowQty(r);
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

export default function BulkStockAdjustForm() {
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
    startedAt: number; // ms timestamp
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
  const [pickerNewCost, setPickerNewCost] = useState<number>(0);
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
  const checkedRows = useMemo(() => rows.filter((r) => r.checked), [rows]);
  const docGroups = useMemo(() => groupByWhShelf(checkedRows), [checkedRows]);
  const totalAmount = useMemo(
    () => checkedRows.reduce((s, r) => s + rowSumAmount(r), 0),
    [checkedRows],
  );

  /** จำนวนแถวใน preview ของ item ที่ picker เพิ่งเลือก (ไว้แสดง dup warning) */
  const pickerExistingCount = useMemo(() => {
    if (!pickerData) return 0;
    return rows.filter((r) => r.item_code === pickerData.item.code).length;
  }, [pickerData, rows]);

  /** หาว่า item ใดมี wh ซ้ำ (อยู่หลาย shelf ใน wh เดียว) → ต้องเตือน */
  const itemWhDupes = useMemo(() => {
    const seen = new Map<string, Set<string>>();
    const dup = new Map<string, Set<string>>();
    for (const r of rows) {
      const s = seen.get(r.item_code) || new Set();
      if (s.has(r.wh_code)) {
        const d = dup.get(r.item_code) || new Set();
        d.add(r.wh_code);
        dup.set(r.item_code, d);
      }
      s.add(r.wh_code);
      seen.set(r.item_code, s);
    }
    return dup;
  }, [rows]);

  function isRowDupWh(r: PreviewRow): boolean {
    return itemWhDupes.get(r.item_code)?.has(r.wh_code) ?? false;
  }

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

    let parsed: { rows: ImportRow[]; warning?: string };
    try {
      parsed = await parseExcel(file);
    } catch (err: unknown) {
      setImportMsg({
        kind: 'error',
        text: err instanceof Error ? err.message : 'อ่านไฟล์ผิดพลาด',
      });
      return;
    }

    // dedupe by item_code — ใช้แถวล่าสุด (cost ค่าหลังสุดชนะ)
    const dedup = new Map<string, ImportRow>();
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
    const uniqueRows = Array.from(dedup.values());

    startImporting(async () => {
      await processRows(uniqueRows, dupSet, parsed.warning);
    });
  }

  async function processRows(
    rows: ImportRow[],
    duplicates: Set<string>,
    parseWarning?: string,
  ) {
    const startedAt = Date.now();
    setLoadProgress({ done: 0, total: rows.length, startedAt });
    const results: ItemResult[] = [];
    const preview: PreviewRow[] = [];

    const BATCH = 5;
    for (let i = 0; i < rows.length; i += BATCH) {
      const slice = rows.slice(i, i + BATCH);
      await Promise.all(
        slice.map(async (r) => {
          const itemCode = (r.item_code || '').trim();
          const unitCode = (r.unit_code || '').trim();
          const newCost = Number(r.new_cost);

          // basic validation
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
          if (!Number.isFinite(newCost)) {
            results.push({
              row_index: r.row_index,
              item_code: itemCode,
              status: 'error',
              error: 'ทุนผิด format',
            });
            return;
          }
          if (newCost < 0) {
            results.push({
              row_index: r.row_index,
              item_code: itemCode,
              status: 'error',
              error: 'ทุนติดลบ',
            });
            return;
          }

          // fetch locations
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

          const units = res.units || [];
          const unit = units.find((u) => u.code === unitCode);
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

          // skip stock_qty ≤ 0
          const positive = (res.locations as ItemLocation[]).filter(
            (l) => l.stock_qty > 0,
          );
          const skipped = res.locations.length - positive.length;

          if (positive.length === 0) {
            results.push({
              row_index: r.row_index,
              item_code: itemCode,
              status: 'no-locations',
              item_name: res.item.name,
              skipped_zero: skipped,
              location_count: 0,
            });
            return;
          }

          results.push({
            row_index: r.row_index,
            item_code: itemCode,
            status: 'ok',
            item_name: res.item.name,
            skipped_zero: skipped,
            location_count: positive.length,
          });

          const unitStd = res.item.unit_standard || unit.code;
          for (const loc of positive) {
            preview.push({
              key: nextKey(),
              row_index: r.row_index,
              item_code: itemCode,
              item_name: res.item.name,
              unit_code: unit.code,
              unit_standard: unitStd,
              new_cost: newCost,
              stand_value: unit.stand_value,
              divide_value: unit.divide_value,
              wh_code: loc.wh_code,
              wh_name: loc.wh_name,
              shelf_code: loc.shelf_code,
              shelf_name: loc.shelf_name,
              stock_qty: loc.stock_qty,
              old_cost: loc.old_cost,
              checked: true,
            });
          }
        }),
      );
      setLoadProgress({
        done: Math.min(i + BATCH, rows.length),
        total: rows.length,
        startedAt,
      });
    }

    // sort preview: wh → shelf → item
    preview.sort(
      (a, b) =>
        a.wh_code.localeCompare(b.wh_code) ||
        a.shelf_code.localeCompare(b.shelf_code) ||
        a.item_code.localeCompare(b.item_code),
    );

    // sort error/info rows by row_index
    results.sort((a, b) => a.row_index - b.row_index);

    setRows(preview);
    setItemResults(results);
    setLoadProgress(null);

    const groupCount = new Set(preview.map((r) => `${r.wh_code}|${r.shelf_code}`))
      .size;
    const errorCount = results.filter((r) => r.status === 'error').length;
    const noLocCount = results.filter((r) => r.status === 'no-locations').length;
    const okCount = results.filter((r) => r.status === 'ok').length;

    const parts: string[] = [];
    parts.push(`อ่าน ${rows.length} item`);
    parts.push(`✓ ${okCount}`);
    if (noLocCount > 0) parts.push(`⊘ ${noLocCount} ไม่มีที่เก็บ`);
    if (errorCount > 0) parts.push(`✗ ${errorCount} error`);
    parts.push(`preview ${preview.length} แถว ใน ${groupCount} ใบ`);

    let kind: 'info' | 'warn' = 'info';
    const extras: string[] = [];
    if (duplicates.size > 0) {
      extras.push(`item ซ้ำ ${duplicates.size} รหัส (ใช้แถวสุดท้าย)`);
      kind = 'warn';
    }
    if (parseWarning) {
      extras.push(parseWarning);
      kind = 'warn';
    }
    setImportMsg({
      kind: errorCount > 0 || kind === 'warn' ? 'warn' : 'info',
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

  // ── Manual picker handlers ──
  function openItemPicker() {
    setPickerKey((k) => k + 1);
    setPickerOpen(true);
  }

  function onPickItem(item: ItemOption) {
    setPickerData(null);
    setPickerUnitCode(item.unit_standard);
    setPickerNewCost(0);
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
      const units = res.units && res.units.length > 0
        ? res.units
        : [{
            code: res.item.unit_standard,
            stand_value: 1,
            divide_value: 1,
            ratio: 1,
          }];
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
    if (!Number.isFinite(pickerNewCost) || pickerNewCost < 0) {
      setImportMsg({ kind: 'error', text: 'กรุณากรอกทุนเป้า (≥ 0)' });
      return;
    }

    startAdding(async () => {
      const positive = pickerData.locations.filter((l) => l.stock_qty > 0);
      const skipped = pickerData.locations.length - positive.length;

      if (positive.length === 0) {
        setImportMsg({
          kind: 'warn',
          text: `${pickerData.item.code} — ไม่มีที่เก็บที่คงเหลือ > 0 (${pickerData.locations.length} skipped)`,
        });
        return;
      }

      const unitStd = pickerData.item.unit_standard || unit.code;
      const newRows: PreviewRow[] = positive.map((loc) => ({
        key: nextKey(),
        row_index: -1, // manual = no Excel row
        item_code: pickerData.item.code,
        item_name: pickerData.item.name,
        unit_code: unit.code,
        unit_standard: unitStd,
        new_cost: pickerNewCost,
        stand_value: unit.stand_value,
        divide_value: unit.divide_value,
        wh_code: loc.wh_code,
        wh_name: loc.wh_name,
        shelf_code: loc.shelf_code,
        shelf_name: loc.shelf_name,
        stock_qty: loc.stock_qty,
        old_cost: loc.old_cost,
        checked: true,
      }));

      // dedupe: ลบแถวเก่าของ item นี้ออกก่อน (replace by latest)
      const code = pickerData.item.code;
      const replaced = rows.some((r) => r.item_code === code);
      const others = rows.filter((r) => r.item_code !== code);
      const merged = [...others, ...newRows].sort(
        (a, b) =>
          a.wh_code.localeCompare(b.wh_code) ||
          a.shelf_code.localeCompare(b.shelf_code) ||
          a.item_code.localeCompare(b.item_code),
      );
      setRows(merged);

      // อัพเดต itemResults (เพิ่ม/แทน entry ของ item นี้)
      setItemResults((prev) => {
        const filtered = prev.filter((r) => r.item_code !== code);
        return [
          ...filtered,
          {
            row_index: 0,
            item_code: code,
            status: 'ok',
            item_name: pickerData.item.name,
            skipped_zero: skipped,
            location_count: positive.length,
          },
        ];
      });

      const msg = replaced
        ? `${code} — แทนแถวเก่า (${newRows.length} แถวใหม่)`
        : `+ ${code} (${newRows.length} แถว)`;
      setImportMsg({
        kind: 'info',
        text: skipped > 0 ? `${msg} · ข้าม ${skipped} ที่เก็บ คงเหลือ ≤ 0` : msg,
      });

      // reset picker
      setPickerData(null);
      setPickerNewCost(0);
    });
  }

  function onSave() {
    if (docGroups.length === 0) {
      setImportMsg({ kind: 'error', text: 'กรุณาเลือกอย่างน้อย 1 แถว' });
      return;
    }

    setOutcomes([]);
    const saveStartedAt = Date.now();
    setSaveProgress({
      done: 0,
      total: docGroups.length,
      startedAt: saveStartedAt,
    });
    setImportMsg(null);

    startSaving(async () => {
      const results: SaveOutcome[] = [];
      for (let i = 0; i < docGroups.length; i++) {
        const g = docGroups[i];
        const lines = g.rows.map((r) => {
          const sum = rowSumAmount(r);
          return {
            item_code: r.item_code,
            item_name: r.item_name,
            unit_code: r.unit_code,
            sum_amount: sum,
            wh_code: r.wh_code,
            shelf_code: r.shelf_code,
            stand_value: r.stand_value,
            divide_value: r.divide_value,
          };
        });
        const groupTotal = lines.reduce((s, l) => s + l.sum_amount, 0);

        const res = await saveStockAdjust({
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
          <Layers className="h-5 w-5 text-purple-600" />
          ปรับต้นทุนทุกที่เก็บ (Bulk IA by Location) — Excel Import
        </h2>

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
          Import จาก Excel
        </h3>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={downloadTemplate}
            className="flex items-center gap-2 rounded-lg border border-purple-300 bg-white px-3 py-2 text-sm font-medium text-purple-700 hover:bg-purple-50"
          >
            <Download className="h-4 w-4" />
            ดาวน์โหลด Template
          </button>

          <label className="flex cursor-pointer items-center gap-2 rounded-lg bg-purple-600 px-3 py-2 text-sm font-medium text-white hover:bg-purple-700">
            <Upload className="h-4 w-4" />
            เลือกไฟล์ Excel
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx"
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
            Template format: <code>รหัสสินค้า | หน่วยนับ | ทุนเฉลี่ยที่ต้องการ</code>
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

          <Field label="ทุนเป้า" className="md:col-span-2">
            <input
              type="number"
              step="0.00001"
              min="0"
              value={pickerNewCost}
              onChange={(e) => setPickerNewCost(Number(e.target.value) || 0)}
              disabled={!pickerData}
              className={`${inputClass} text-right`}
            />
          </Field>

          <div className="flex items-end md:col-span-2">
            <button
              type="button"
              onClick={addManualItem}
              disabled={!pickerData || isAdding || pickerNewCost <= 0}
              className={`flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-gray-300 ${
                pickerExistingCount > 0
                  ? 'bg-amber-600 hover:bg-amber-700'
                  : 'bg-purple-600 hover:bg-purple-700'
              }`}
              title={
                !pickerData
                  ? 'เลือกสินค้าก่อน'
                  : pickerExistingCount > 0
                    ? `แทน ${pickerExistingCount} แถวเดิมของ ${pickerData.item.code} ด้วยค่าใหม่`
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
            <div className="md:col-span-12 flex items-start gap-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              <span>
                <b>{pickerData.item.code}</b> มีอยู่ใน preview แล้ว{' '}
                <b>{pickerExistingCount}</b> แถว — กดเพิ่มจะ
                <b>แทนทุกแถวเดิม</b>ด้วยค่าใหม่ (ทุน/หน่วยที่กรอกตอนนี้)
              </span>
            </div>
          )}

          {pickerData && pickerData.locations.length > 0 && (
            <div className="md:col-span-12 text-xs text-gray-500">
              พบ {pickerData.locations.length} ที่เก็บ
              {(() => {
                const positive = pickerData.locations.filter(
                  (l) => l.stock_qty > 0,
                );
                const skipped = pickerData.locations.length - positive.length;
                return skipped > 0
                  ? ` — จะใส่ ${positive.length} แถว (ข้าม ${skipped} ที่ คงเหลือ ≤ 0)`
                  : ` — จะใส่ ${positive.length} แถว`;
              })()}
            </div>
          )}
        </div>
      </div>

      {/* ── Item-level errors / no-location ── */}
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
                  {r.status === 'error' ? (
                    <XCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600" />
                  ) : (
                    <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
                  )}
                  <span className="text-gray-400">row {r.row_index}</span>
                  <span className="font-mono text-xs">{r.item_code || '(ว่าง)'}</span>
                  {r.item_name && (
                    <span className="text-gray-700">{r.item_name}</span>
                  )}
                  <span
                    className={
                      r.status === 'error' ? 'text-red-700' : 'text-amber-800'
                    }
                  >
                    {r.status === 'error'
                      ? r.error
                      : `ไม่อยู่ใน ic_wh_shelf หรือคงเหลือ ≤ 0 ทุกที่ (${r.skipped_zero ?? 0} skipped)`}
                  </span>
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

          {itemWhDupes.size > 0 && (
            <div className="mb-3 flex items-start gap-2 rounded-lg bg-yellow-50 p-3 text-sm text-yellow-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <div>
                <div className="font-semibold">
                  พบ item ที่มีหลายพื้นที่ในคลังเดียวกัน
                </div>
                <div className="text-xs">
                  stock + ทุนเฉลี่ย track ระดับ <b>คลัง</b> ไม่ใช่พื้นที่ —
                  ถ้าบันทึกหลายใบใน wh เดียวกันสำหรับ item เดียวกัน → avg cost
                  จะถูกปรับซ้อน (overshoot เกินเป้า) แถวที่ทำให้เกิดเคสนี้ขึ้นพื้นสีเหลือง
                </div>
              </div>
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
                  <th className="px-2 py-2 text-right">ทุนเดิม</th>
                  <th className="px-2 py-2 text-right">ทุนเป้า</th>
                  <th className="px-2 py-2 text-right">มูลค่าปรับ</th>
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
                      isRowDupWh={isRowDupWh}
                      onToggleRow={toggleRow}
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
                    รวมมูลค่า ({docGroups.length} ใบ)
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
              disabled={isSaving || docGroups.length === 0}
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

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return `${m}m ${String(rs).padStart(2, '0')}s`;
}

interface LoadProgressBarProps {
  done: number;
  total: number;
  startedAt: number;
}

/** Progress bar + tick ทุก 500ms ให้ elapsed/ETA วิ่ง */
function LoadProgressBar({ done, total, startedAt }: LoadProgressBarProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  const elapsed = Math.max(0, now - startedAt);
  const pct = total > 0 ? (done / total) * 100 : 0;
  const avgPerItem = done > 0 ? elapsed / done : 0;
  const remaining = avgPerItem * (total - done);
  const showEta = done > 0 && done < total;

  return (
    <div className="mt-3 space-y-1">
      <div className="flex flex-wrap items-baseline gap-x-3 text-sm">
        <span className="text-gray-700">
          กำลังโหลดที่เก็บ <b>{done}</b> / {total} item
        </span>
        <span className="text-xs text-gray-500">
          ใช้เวลา {formatDuration(elapsed)}
        </span>
        {showEta && (
          <span className="text-xs text-gray-500">
            · เหลือ ~{formatDuration(Math.round(remaining))}
          </span>
        )}
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
        <div
          className="h-full bg-purple-600 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

interface SaveProgressLineProps {
  done: number;
  total: number;
  startedAt: number;
  allDone: boolean;
  successCount: number;
  failCount: number;
}

function SaveProgressLine({
  done,
  total,
  startedAt,
  allDone,
  successCount,
  failCount,
}: SaveProgressLineProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (allDone) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [allDone]);

  const elapsed = Math.max(0, now - startedAt);
  const avgPerItem = done > 0 ? elapsed / done : 0;
  const remaining = avgPerItem * (total - done);
  const showEta = done > 0 && done < total && !allDone;

  return (
    <span className="flex flex-wrap items-baseline gap-x-3">
      <span>
        บันทึก <b>{done}</b> / {total} ใบ
      </span>
      <span className="text-xs text-gray-500">{formatDuration(elapsed)}</span>
      {showEta && (
        <span className="text-xs text-gray-500">
          · เหลือ ~{formatDuration(Math.round(remaining))}
        </span>
      )}
      {allDone && (
        <span className="font-semibold">
          — เสร็จสิ้น (
          <span className="text-green-700">{successCount} สำเร็จ</span>
          {failCount > 0 && (
            <>
              , <span className="text-red-700">{failCount} ล้มเหลว</span>
            </>
          )}
          )
        </span>
      )}
    </span>
  );
}

interface GroupBlockProps {
  group: DocGroup;
  docNumber: number;
  groupSum: number;
  amountDecimal: number;
  isRowDupWh: (r: PreviewRow) => boolean;
  onToggleRow: (key: number) => void;
  onToggleGroup: (check: boolean) => void;
}

function GroupBlock({
  group,
  docNumber,
  groupSum,
  amountDecimal,
  isRowDupWh,
  onToggleRow,
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
        const qty = rowQty(r);
        const sum = rowSumAmount(r);
        const dup = isRowDupWh(r);
        return (
          <tr
            key={r.key}
            className={`border-t ${dup ? 'bg-yellow-50/60' : ''}`}
          >
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
              <div>
                {formatMoney(r.stock_qty)} {r.unit_standard}
              </div>
              {r.unit_code !== r.unit_standard && (
                <div className="text-[10px] text-gray-400">
                  = {formatMoney(qty)} {r.unit_code}
                </div>
              )}
            </td>
            <td className="px-2 py-1 text-right text-xs tabular-nums">
              {formatMoney(r.old_cost)}
            </td>
            <td className="px-2 py-1 text-right text-xs tabular-nums">
              {formatMoney(r.new_cost)}
            </td>
            <td className="px-2 py-1 text-right font-medium tabular-nums">
              {formatAmount(sum, amountDecimal)}
            </td>
          </tr>
        );
      })}
    </>
  );
}

// ──────────────────────────── Styles ────────────────────────────

const inputClass =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500';

function Field({
  label,
  children,
  className = '',
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-1 ${className}`}>
      <span className="text-xs font-medium text-gray-600">{label}</span>
      {children}
    </label>
  );
}
