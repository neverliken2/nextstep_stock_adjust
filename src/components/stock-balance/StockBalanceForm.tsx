'use client';

import { useMemo, useState, useTransition } from 'react';
import {
  Save,
  Plus,
  Trash2,
  FileSpreadsheet,
  Search,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import {
  getItemDefaults,
  searchWarehouses,
  searchShelves,
  type UnitOption,
  type ItemOption,
} from '@/actions/stock-adjust';
import {
  saveStockBalance,
  type StockBalanceLinePayload,
  type ValidatedBalanceRow,
} from '@/actions/stock-balance';
import ItemPickerModal from '@/components/stock-adjust/ItemPickerModal';
import LookupPickerModal, {
  type LookupOption,
} from '@/components/stock-adjust/LookupPickerModal';
import BalanceImportModal from './BalanceImportModal';
import DateInputDDMMYYYY from '@/components/ui/DateInputDDMMYYYY';

/**
 * ฟอร์มเอกสาร "สินค้า/วัตถุดิบ คงเหลือยกมา" (RMB, trans_flag=54)
 *
 * Concept เดียวกับเมนู "ปรับต้นทุนทุกที่เก็บ":
 * - ไม่เลือกคลังที่ header — คลัง/ที่เก็บ ระบุรายบรรทัด (กรอกเอง หรือมากับ import)
 * - ตอนบันทึก ระบบ group บรรทัดเป็น 1 ใบเอกสารต่อ (คลัง, ที่เก็บ) อัตโนมัติ
 * - user กรอก จำนวน + ต้นทุน/หน่วย เอง (มูลค่า = จำนวน × ต้นทุน)
 */
interface EditableLine {
  key: number;
  item_code: string;
  item_name: string;
  unit_code: string;
  units: UnitOption[];
  wh_code: string;
  shelf_code: string;
  qty: number;
  cost: number; // ต้นทุน/หน่วย (ในหน่วย unit_code)
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

let lineCounter = 0;
const nextKey = () => ++lineCounter;

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

function groupByWhShelf(lines: EditableLine[]): Map<string, EditableLine[]> {
  const map = new Map<string, EditableLine[]>();
  for (const l of lines) {
    const key = `${l.wh_code}|${l.shelf_code}`;
    const list = map.get(key) || [];
    list.push(l);
    map.set(key, list);
  }
  return map;
}

export default function StockBalanceForm() {
  // ── Header state ──
  const [docDate, setDocDate] = useState<string>(todayISO());
  const [docTime, setDocTime] = useState<string>(nowHHMM());
  const [docRef, setDocRef] = useState<string>('');
  const [docRefDate, setDocRefDate] = useState<string>('');
  const [remark, setRemark] = useState<string>('');

  // ── Lines ──
  const [lines, setLines] = useState<EditableLine[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerKey, setPickerKey] = useState(0);
  const [importOpen, setImportOpen] = useState(false);

  // ── Wh/Shelf picker (รายบรรทัด) ──
  const [lookupOpen, setLookupOpen] = useState(false);
  const [lookupKey, setLookupKey] = useState(0);
  const [lookupTarget, setLookupTarget] = useState<{
    kind: 'wh' | 'shelf';
    lineKey: number;
  } | null>(null);

  function openLookup(kind: 'wh' | 'shelf', lineKey: number) {
    setLookupTarget({ kind, lineKey });
    setLookupKey((k) => k + 1);
    setLookupOpen(true);
  }

  function onLookupSelect(opt: LookupOption) {
    if (!lookupTarget) return;
    if (lookupTarget.kind === 'wh') {
      // เปลี่ยนคลัง → reset ที่เก็บของบรรทัดนั้น
      updateLine(lookupTarget.lineKey, { wh_code: opt.code, shelf_code: '' });
    } else {
      updateLine(lookupTarget.lineKey, { shelf_code: opt.code });
    }
  }

  const lookupSearchFn: (q: string) => Promise<LookupOption[]> = !lookupTarget
    ? async () => []
    : lookupTarget.kind === 'wh'
      ? (q: string) => searchWarehouses(q)
      : (() => {
          const wh =
            lines.find((l) => l.key === lookupTarget.lineKey)?.wh_code || '';
          return (q: string) => searchShelves(q, wh);
        })();

  const lookupHint = !lookupTarget
    ? undefined
    : lookupTarget.kind === 'shelf'
      ? (() => {
          const wh =
            lines.find((l) => l.key === lookupTarget.lineKey)?.wh_code || '';
          return wh ? `กรองเฉพาะคลัง ${wh}` : 'แสดงทุกคลัง (ยังไม่ได้เลือกคลัง)';
        })()
      : undefined;

  // ── Save ──
  const [isSaving, startSaving] = useTransition();
  const [saveMsg, setSaveMsg] = useState<{
    kind: 'success' | 'error';
    text: string;
  } | null>(null);
  const [outcomes, setOutcomes] = useState<SaveOutcome[]>([]);

  // ── Computed total: SUM(qty × cost) ──
  const totalAmount = useMemo(
    () => lines.reduce((s, l) => s + Number(l.qty) * Number(l.cost), 0),
    [lines],
  );

  /** จำนวนใบเอกสารที่จะถูกสร้าง (group ตาม คลัง+ที่เก็บ) */
  const docCount = useMemo(() => {
    const filled = lines.filter((l) => l.wh_code && l.shelf_code);
    return groupByWhShelf(filled).size;
  }, [lines]);

  function addLine() {
    setPickerKey((k) => k + 1);
    setPickerOpen(true);
  }

  async function onPickItem(item: ItemOption) {
    // ดึงแค่ item + units (ไม่ส่ง wh → ไม่ query stock) — default cost = ทุนเฉลี่ยปัจจุบัน
    const defaults = await getItemDefaults(item.code, '', '');
    const units = defaults.units || [];
    const unitStandard =
      defaults.item?.unit_standard || item.unit_standard || units[0]?.code || '';
    // default wh/shelf = บรรทัดล่าสุด (สะดวกตอนคีย์ต่อเนื่องที่เก็บเดียวกัน)
    setLines((prev) => {
      const last = prev[prev.length - 1];
      return [
        ...prev,
        {
          key: nextKey(),
          item_code: item.code,
          item_name: item.name,
          unit_code: unitStandard,
          units,
          wh_code: last?.wh_code || '',
          shelf_code: last?.shelf_code || '',
          qty: 0,
          cost: defaults.item?.average_cost ?? item.average_cost ?? 0,
        },
      ];
    });
  }

  function onImport(imported: ValidatedBalanceRow[]) {
    setLines((prev) => [
      ...prev,
      ...imported.map((r) => ({
        key: nextKey(),
        item_code: r.item_code,
        item_name: r.item_name || '',
        unit_code: r.unit_code,
        units: r.units || [
          {
            code: r.unit_code,
            stand_value: r.stand_value ?? 1,
            divide_value: r.divide_value ?? 1,
            ratio: (r.stand_value ?? 1) / (r.divide_value ?? 1),
          },
        ],
        wh_code: r.wh_code,
        shelf_code: r.shelf_code,
        qty: r.qty,
        cost: r.cost,
      })),
    ]);
  }

  function removeLine(key: number) {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }

  function updateLine(key: number, patch: Partial<EditableLine>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function onSubmit() {
    setSaveMsg(null);
    setOutcomes([]);

    const noLocation = lines.find((l) => !l.wh_code.trim() || !l.shelf_code.trim());
    if (noLocation) {
      setSaveMsg({
        kind: 'error',
        text: `กรุณาระบุคลัง/ที่เก็บ — ตรวจสอบรายการ ${noLocation.item_code}`,
      });
      return;
    }
    const badLine = lines.find((l) => !(Number(l.qty) > 0));
    if (badLine) {
      setSaveMsg({
        kind: 'error',
        text: `จำนวนต้องมากกว่า 0 — ตรวจสอบรายการ ${badLine.item_code}`,
      });
      return;
    }
    const badCost = lines.find((l) => Number(l.cost) < 0);
    if (badCost) {
      setSaveMsg({
        kind: 'error',
        text: `ต้นทุนติดลบไม่ได้ — ตรวจสอบรายการ ${badCost.item_code}`,
      });
      return;
    }

    const groups = groupByWhShelf(lines);
    if (
      groups.size > 1 &&
      !confirm(`รายการมี ${groups.size} ที่เก็บ — ระบบจะสร้าง ${groups.size} ใบเอกสาร ยืนยัน?`)
    ) {
      return;
    }

    startSaving(async () => {
      const results: SaveOutcome[] = [];
      const failedKeys = new Set<number>();

      // save ทีละใบ (sequential — เลขเอกสาร gen ต่อเนื่อง ไม่ชนกัน)
      for (const [, groupLines] of groups) {
        const { wh_code, shelf_code } = groupLines[0];
        const payloadLines: StockBalanceLinePayload[] = groupLines.map((l) => {
          const unit = l.units.find((u) => u.code === l.unit_code);
          return {
            item_code: l.item_code,
            item_name: l.item_name,
            unit_code: l.unit_code,
            qty: Number(l.qty),
            price: Number(l.cost),
            wh_code: l.wh_code,
            shelf_code: l.shelf_code,
            stand_value: unit?.stand_value ?? 1,
            divide_value: unit?.divide_value ?? 1,
          };
        });
        const groupTotal = groupLines.reduce(
          (s, l) => s + Number(l.qty) * Number(l.cost),
          0,
        );

        const res = await saveStockBalance({
          doc_date: docDate,
          doc_time: docTime,
          doc_ref: docRef,
          doc_ref_date: docRefDate,
          wh_from: wh_code,
          location_from: shelf_code,
          remark,
          lines: payloadLines,
        });

        results.push({
          wh_code,
          shelf_code,
          line_count: groupLines.length,
          total_amount: groupTotal,
          success: res.success,
          doc_no: res.doc_no,
          message: res.message,
        });
        if (!res.success) {
          for (const l of groupLines) failedKeys.add(l.key);
        }
      }

      setOutcomes(results);
      const failCount = results.filter((r) => !r.success).length;
      if (failCount === 0) {
        setSaveMsg({
          kind: 'success',
          text: `บันทึกสำเร็จ ${results.length} ใบเอกสาร`,
        });
        // reset form
        setLines([]);
        setDocRef('');
        setDocRefDate('');
        setRemark('');
        setDocTime(nowHHMM());
      } else {
        // เก็บเฉพาะบรรทัดของใบที่ fail ไว้ให้แก้/ลองใหม่
        setLines((prev) => prev.filter((l) => failedKeys.has(l.key)));
        setSaveMsg({
          kind: 'error',
          text: `สำเร็จ ${results.length - failCount} ใบ, ล้มเหลว ${failCount} ใบ — บรรทัดของใบที่ล้มเหลวยังอยู่ในตาราง`,
        });
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-base font-semibold text-gray-800">
          เอกสารสินค้า/วัตถุดิบ คงเหลือยกมา (RMB)
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
              value="คงเหลือยกมา"
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
          <Field label="หมายเหตุ">
            <input
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              maxLength={255}
              className={inputClass}
            />
          </Field>
        </div>
        <p className="mt-2 text-xs text-gray-500">
          ระบุคลัง/ที่เก็บที่แต่ละบรรทัด — ตอนบันทึกระบบจะแยก 1 ใบเอกสารต่อ
          (คลัง, ที่เก็บ) อัตโนมัติ
        </p>
      </div>

      <div className="rounded-xl bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-800">รายการสินค้า</h3>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setImportOpen(true)}
              className="flex items-center gap-2 rounded-lg border border-purple-300 bg-white px-3 py-2 text-sm font-medium text-purple-700 hover:bg-purple-50"
              title="Import จาก Excel"
            >
              <FileSpreadsheet className="h-4 w-4" /> Excel
            </button>
            <button
              type="button"
              onClick={addLine}
              className="flex items-center gap-2 rounded-lg bg-purple-600 px-3 py-2 text-sm font-medium text-white hover:bg-purple-700"
            >
              <Plus className="h-4 w-4" /> เพิ่มรายการ
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-600">
              <tr>
                <th className="px-2 py-2 text-left">รหัสสินค้า</th>
                <th className="px-2 py-2 text-left">ชื่อสินค้า</th>
                <th className="px-2 py-2 text-left">คลัง</th>
                <th className="px-2 py-2 text-left">ที่เก็บ</th>
                <th className="px-2 py-2 text-left">หน่วย</th>
                <th className="px-2 py-2 text-right">จำนวน</th>
                <th className="px-2 py-2 text-right">ต้นทุน/หน่วย</th>
                <th className="px-2 py-2 text-right">มูลค่า</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 && (
                <tr>
                  <td
                    colSpan={9}
                    className="px-2 py-6 text-center text-sm text-gray-400"
                  >
                    ยังไม่มีรายการ — กด &quot;เพิ่มรายการ&quot; หรือ Import Excel
                  </td>
                </tr>
              )}
              {lines.map((l) => {
                const sum = Number(l.qty) * Number(l.cost);
                return (
                  <tr key={l.key} className="border-t">
                    <td className="px-2 py-1 font-mono text-xs">{l.item_code}</td>
                    <td className="px-2 py-1">{l.item_name}</td>
                    <td className="px-2 py-1">
                      <div className="flex gap-0.5">
                        <input
                          value={l.wh_code}
                          onChange={(e) =>
                            updateLine(l.key, {
                              wh_code: e.target.value.toUpperCase(),
                            })
                          }
                          maxLength={25}
                          className={`${cellInputClass} w-20 flex-1`}
                        />
                        <button
                          type="button"
                          onClick={() => openLookup('wh', l.key)}
                          className="rounded border border-gray-200 px-1.5 text-gray-500 hover:bg-purple-50 hover:text-purple-600"
                          title="ค้นหาคลัง"
                        >
                          <Search className="h-3 w-3" />
                        </button>
                      </div>
                    </td>
                    <td className="px-2 py-1">
                      <div className="flex gap-0.5">
                        <input
                          value={l.shelf_code}
                          onChange={(e) =>
                            updateLine(l.key, {
                              shelf_code: e.target.value.toUpperCase(),
                            })
                          }
                          maxLength={25}
                          className={`${cellInputClass} w-20 flex-1`}
                        />
                        <button
                          type="button"
                          onClick={() => openLookup('shelf', l.key)}
                          className="rounded border border-gray-200 px-1.5 text-gray-500 hover:bg-purple-50 hover:text-purple-600"
                          title="ค้นหาที่เก็บ"
                        >
                          <Search className="h-3 w-3" />
                        </button>
                      </div>
                    </td>
                    <td className="px-2 py-1">
                      <select
                        value={l.unit_code}
                        onChange={(e) => updateLine(l.key, { unit_code: e.target.value })}
                        className={cellInputClass}
                      >
                        {l.units.length === 0 && <option value="">-</option>}
                        {l.units.map((u) => (
                          <option key={u.code} value={u.code}>
                            {u.code} ({u.ratio})
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      <input
                        type="number"
                        step="0.001"
                        min="0"
                        value={l.qty}
                        onChange={(e) =>
                          updateLine(l.key, { qty: Number(e.target.value) || 0 })
                        }
                        className={`${cellInputClass} w-24 text-right`}
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        type="number"
                        step="0.00001"
                        min="0"
                        value={l.cost}
                        onChange={(e) =>
                          updateLine(l.key, { cost: Number(e.target.value) || 0 })
                        }
                        className={`${cellInputClass} w-28 text-right`}
                      />
                    </td>
                    <td className="px-2 py-1 text-right font-medium text-gray-900">
                      {formatMoney(sum)}
                    </td>
                    <td className="px-2 py-1 text-center">
                      <button
                        type="button"
                        onClick={() => removeLine(l.key)}
                        className="rounded p-1 text-red-500 hover:bg-red-50"
                        title="ลบ"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {lines.length > 0 && (
              <tfoot className="bg-gray-50">
                <tr>
                  <td colSpan={7} className="px-2 py-2 text-right font-semibold text-gray-700">
                    รวมมูลค่า {docCount > 1 ? `(จะสร้าง ${docCount} ใบเอกสาร)` : ''}
                  </td>
                  <td className="px-2 py-2 text-right text-lg font-bold text-purple-700">
                    {formatMoney(totalAmount)}
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* ผลการบันทึกรายใบ */}
      {outcomes.length > 0 && (
        <div className="rounded-xl bg-white p-4 shadow-sm">
          <h3 className="mb-2 text-sm font-semibold text-gray-800">
            ผลการบันทึก ({outcomes.length} ใบ)
          </h3>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-600">
              <tr>
                <th className="px-2 py-1 text-center w-10">สถานะ</th>
                <th className="px-2 py-1 text-left">คลัง</th>
                <th className="px-2 py-1 text-left">ที่เก็บ</th>
                <th className="px-2 py-1 text-right">รายการ</th>
                <th className="px-2 py-1 text-right">มูลค่า</th>
                <th className="px-2 py-1 text-left">เลขที่เอกสาร / ข้อความ</th>
              </tr>
            </thead>
            <tbody>
              {outcomes.map((o, i) => (
                <tr key={i} className={`border-t ${o.success ? '' : 'bg-red-50'}`}>
                  <td className="px-2 py-1 text-center">
                    {o.success ? (
                      <CheckCircle2 className="inline h-4 w-4 text-green-600" />
                    ) : (
                      <XCircle className="inline h-4 w-4 text-red-600" />
                    )}
                  </td>
                  <td className="px-2 py-1">{o.wh_code}</td>
                  <td className="px-2 py-1">{o.shelf_code}</td>
                  <td className="px-2 py-1 text-right">{o.line_count}</td>
                  <td className="px-2 py-1 text-right">{formatMoney(o.total_amount)}</td>
                  <td className="px-2 py-1">
                    {o.success ? (
                      <span className="font-mono text-xs">{o.doc_no}</span>
                    ) : (
                      <span className="text-xs text-red-600">{o.message}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-between rounded-xl bg-white p-4 shadow-sm">
        <div className="text-sm">
          {saveMsg && (
            <span
              className={
                saveMsg.kind === 'success' ? 'text-green-700' : 'text-red-700'
              }
            >
              {saveMsg.text}
            </span>
          )}
        </div>
        <button
          type="button"
          disabled={isSaving || lines.length === 0}
          onClick={onSubmit}
          className="flex items-center gap-2 rounded-lg bg-green-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          <Save className="h-4 w-4" />
          {isSaving
            ? 'กำลังบันทึก...'
            : docCount > 1
              ? `บันทึก (${docCount} ใบ)`
              : 'บันทึก'}
        </button>
      </div>

      <ItemPickerModal
        key={`picker-${pickerKey}`}
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={onPickItem}
      />

      <BalanceImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImport={onImport}
      />

      <LookupPickerModal
        key={`lookup-${lookupKey}`}
        open={lookupOpen}
        title={lookupTarget?.kind === 'wh' ? 'เลือกคลัง' : 'เลือกพื้นที่เก็บ'}
        searchFn={lookupSearchFn}
        hint={lookupHint}
        onClose={() => setLookupOpen(false)}
        onSelect={onLookupSelect}
      />
    </div>
  );
}

const inputClass =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500';

const cellInputClass =
  'w-full rounded border border-gray-200 px-2 py-1 text-sm focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500';

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
