'use client';

import { useMemo, useState, useTransition } from 'react';
import { Save, Plus, Trash2, RefreshCw, FileSpreadsheet, Search } from 'lucide-react';
import {
  getItemDefaults,
  saveStockAdjust,
  searchWarehouses,
  searchShelves,
  type StockAdjustLinePayload,
  type UnitOption,
  type ItemOption,
  type ValidatedImportRow,
} from '@/actions/stock-adjust';
import ItemPickerModal from './ItemPickerModal';
import ImportModal from './ImportModal';
import LookupPickerModal, { type LookupOption } from './LookupPickerModal';

interface EditableLine {
  key: number;
  item_code: string;
  item_name: string;
  unit_code: string;
  unit_standard: string; // หน่วยเล็กสุด (ใช้แสดง stock_qty)
  units: UnitOption[];
  old_cost: number;
  new_cost: number;
  wh_code: string;
  shelf_code: string;
  stock_qty: number; // คงเหลือในหน่วย unit_standard
}

// qty (ในหน่วย unit ที่เลือก) = stock_qty (in unit_standard) / ratio
function lineQty(l: EditableLine): number {
  const unit = l.units.find((u) => u.code === l.unit_code);
  const ratio = (unit?.stand_value ?? 1) / (unit?.divide_value ?? 1);
  return l.stock_qty / (ratio || 1);
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

export default function StockAdjustForm() {
  // ── Header state ──
  const [docDate, setDocDate] = useState<string>(todayISO());
  const [docTime, setDocTime] = useState<string>(nowHHMM());
  const [docRef, setDocRef] = useState<string>('');
  const [docRefDate, setDocRefDate] = useState<string>('');
  const [whFrom, setWhFrom] = useState<string>('');
  const [locationFrom, setLocationFrom] = useState<string>('');
  const [remark, setRemark] = useState<string>('');

  // ── Lines ──
  const [lines, setLines] = useState<EditableLine[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerKey, setPickerKey] = useState(0);
  const [importOpen, setImportOpen] = useState(false);

  // ── Wh/Shelf picker state ──
  // target: 'header' | line key, kind: 'wh' | 'shelf'
  const [lookupOpen, setLookupOpen] = useState(false);
  const [lookupKey, setLookupKey] = useState(0);
  const [lookupTarget, setLookupTarget] = useState<
    | { kind: 'wh' | 'shelf'; scope: 'header' }
    | { kind: 'wh' | 'shelf'; scope: 'line'; lineKey: number }
    | null
  >(null);

  function openWhPicker(scope: 'header' | { lineKey: number }) {
    setLookupTarget(
      scope === 'header'
        ? { kind: 'wh', scope: 'header' }
        : { kind: 'wh', scope: 'line', lineKey: scope.lineKey }
    );
    setLookupKey((k) => k + 1);
    setLookupOpen(true);
  }

  function openShelfPicker(scope: 'header' | { lineKey: number }) {
    setLookupTarget(
      scope === 'header'
        ? { kind: 'shelf', scope: 'header' }
        : { kind: 'shelf', scope: 'line', lineKey: scope.lineKey }
    );
    setLookupKey((k) => k + 1);
    setLookupOpen(true);
  }

  function onLookupSelect(opt: LookupOption) {
    if (!lookupTarget) return;
    if (lookupTarget.scope === 'header') {
      if (lookupTarget.kind === 'wh') {
        setWhFrom(opt.code);
        setLocationFrom(''); // reset shelf เมื่อเปลี่ยน wh
      } else {
        setLocationFrom(opt.code);
      }
    } else {
      const k = lookupTarget.lineKey;
      if (lookupTarget.kind === 'wh') {
        updateLine(k, { wh_code: opt.code, shelf_code: '' });
      } else {
        updateLine(k, { shelf_code: opt.code });
      }
    }
  }

  // searchFn ปัจจุบัน (ขึ้นกับ target) — recompute ทุก render OK เพราะใช้ใน prop ของ modal
  const lookupSearchFn: (q: string) => Promise<LookupOption[]> = !lookupTarget
    ? async () => []
    : lookupTarget.kind === 'wh'
      ? (q: string) => searchWarehouses(q)
      : (() => {
          const whForFilter =
            lookupTarget.scope === 'header'
              ? whFrom
              : lines.find((l) => l.key === lookupTarget.lineKey)?.wh_code || whFrom;
          return (q: string) => searchShelves(q, whForFilter);
        })();

  const lookupTitle = !lookupTarget
    ? ''
    : lookupTarget.kind === 'wh'
      ? 'เลือกคลัง'
      : 'เลือกพื้นที่เก็บ';

  const lookupHint = !lookupTarget
    ? undefined
    : lookupTarget.kind === 'shelf'
      ? (() => {
          const wh =
            lookupTarget.scope === 'header'
              ? whFrom
              : lines.find((l) => l.key === lookupTarget.lineKey)?.wh_code || whFrom;
          return wh ? `กรองเฉพาะคลัง ${wh}` : 'แสดงทุกคลัง (ยังไม่ได้เลือกคลัง)';
        })()
      : undefined;

  // ── Save ──
  const [isSaving, startSaving] = useTransition();
  const [saveMsg, setSaveMsg] = useState<{
    kind: 'success' | 'error';
    text: string;
  } | null>(null);

  // ── Computed total: SUM((target − old) × qty) ──
  // new_cost field = ทุนเฉลี่ยที่ user ต้องการให้เป็น (target_avg)
  // sum_amount = (target − old) × qty → ทำให้ avg ใหม่ = target พอดี (value-only adjust)
  // qty คำนวณจาก stock_qty / ratio ของ unit ที่เลือก → คำนวณ live ตอน user แก้ค่า
  const totalAmount = useMemo(
    () =>
      lines.reduce(
        (s, l) =>
          s + (Number(l.new_cost) - Number(l.old_cost)) * lineQty(l),
        0
      ),
    [lines]
  );

  function addLine() {
    setPickerKey((k) => k + 1);
    setPickerOpen(true);
  }

  function onImport(imported: ValidatedImportRow[]) {
    setLines((prev) => [
      ...prev,
      ...imported.map((r) => ({
        key: nextKey(),
        item_code: r.item_code,
        item_name: r.item_name || '',
        unit_code: r.unit_code,
        unit_standard: r.unit_standard || r.unit_code,
        units: r.units || [
          {
            code: r.unit_code,
            stand_value: r.stand_value ?? 1,
            divide_value: r.divide_value ?? 1,
            ratio: (r.stand_value ?? 1) / (r.divide_value ?? 1),
          },
        ],
        old_cost: r.old_cost ?? 0,
        new_cost: r.new_cost,
        wh_code: whFrom,
        shelf_code: locationFrom,
        stock_qty: r.stock_qty ?? 0,
      })),
    ]);
  }

  async function onPickItem(item: ItemOption) {
    const defaults = await getItemDefaults(item.code, whFrom);
    const units = defaults.units || [];
    const unitStandard = defaults.item?.unit_standard || item.unit_standard || units[0]?.code || '';
    setLines((prev) => [
      ...prev,
      {
        key: nextKey(),
        item_code: item.code,
        item_name: item.name,
        unit_code: unitStandard,
        unit_standard: unitStandard,
        units,
        old_cost: defaults.item?.average_cost ?? item.average_cost,
        new_cost: 0,
        wh_code: whFrom,
        shelf_code: locationFrom,
        stock_qty: defaults.stock_qty ?? 0,
      },
    ]);
  }

  function removeLine(key: number) {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }

  function updateLine(key: number, patch: Partial<EditableLine>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  async function refreshStock(line: EditableLine) {
    const defaults = await getItemDefaults(line.item_code, whFrom || line.wh_code);
    updateLine(line.key, {
      old_cost: defaults.item?.average_cost ?? line.old_cost,
      stock_qty: defaults.stock_qty ?? 0,
    });
  }

  function onSubmit() {
    setSaveMsg(null);
    const payloadLines: StockAdjustLinePayload[] = lines.map((l) => {
      const unit = l.units.find((u) => u.code === l.unit_code);
      const qty = lineQty(l);
      const sumAmount = (Number(l.new_cost) - Number(l.old_cost)) * qty;
      return {
        item_code: l.item_code,
        item_name: l.item_name,
        unit_code: l.unit_code,
        sum_amount: sumAmount, // ส่งแค่มูลค่ารวม — server insert qty=0, price=0
        wh_code: l.wh_code || whFrom,
        shelf_code: l.shelf_code || locationFrom,
        stand_value: unit?.stand_value ?? 1,
        divide_value: unit?.divide_value ?? 1,
      };
    });

    startSaving(async () => {
      const res = await saveStockAdjust({
        doc_date: docDate,
        doc_time: docTime,
        doc_ref: docRef,
        doc_ref_date: docRefDate,
        wh_from: whFrom,
        location_from: locationFrom,
        remark,
        lines: payloadLines,
      });
      if (res.success) {
        setSaveMsg({ kind: 'success', text: res.message });
        // reset form
        setLines([]);
        setDocRef('');
        setDocRefDate('');
        setRemark('');
        setDocTime(nowHHMM());
      } else {
        setSaveMsg({ kind: 'error', text: res.message });
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-base font-semibold text-gray-800">
          เอกสารปรับปรุงสินค้า (IA)
        </h2>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label="วันที่เอกสาร *">
            <input
              type="date"
              value={docDate}
              onChange={(e) => setDocDate(e.target.value)}
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
            <input
              type="date"
              value={docRefDate}
              onChange={(e) => setDocRefDate(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="คลัง * (default)">
            <div className="flex gap-1">
              <input
                value={whFrom}
                onChange={(e) => setWhFrom(e.target.value.toUpperCase())}
                placeholder="เช่น MMA01"
                maxLength={25}
                className={`${inputClass} flex-1`}
              />
              <button
                type="button"
                onClick={() => openWhPicker('header')}
                className="rounded-lg border border-purple-300 bg-white px-3 text-purple-600 hover:bg-purple-50"
                title="ค้นหาคลัง"
              >
                <Search className="h-4 w-4" />
              </button>
            </div>
          </Field>
          <Field label="พื้นที่เก็บ (default)">
            <div className="flex gap-1">
              <input
                value={locationFrom}
                onChange={(e) => setLocationFrom(e.target.value.toUpperCase())}
                placeholder="เช่น SH101"
                maxLength={25}
                className={`${inputClass} flex-1`}
              />
              <button
                type="button"
                onClick={() => openShelfPicker('header')}
                className="rounded-lg border border-purple-300 bg-white px-3 text-purple-600 hover:bg-purple-50"
                title="ค้นหาพื้นที่เก็บ"
              >
                <Search className="h-4 w-4" />
              </button>
            </div>
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
                <th className="px-2 py-2 text-left">พื้นที่</th>
                <th className="px-2 py-2 text-left">หน่วย</th>
                <th className="px-2 py-2 text-right">คงเหลือ</th>
                <th className="px-2 py-2 text-right">ทุนเดิม</th>
                <th className="px-2 py-2 text-right">ทุนเฉลี่ยที่ต้องการ</th>
                <th className="px-2 py-2 text-right">มูลค่า</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 && (
                <tr>
                  <td
                    colSpan={10}
                    className="px-2 py-6 text-center text-sm text-gray-400"
                  >
                    ยังไม่มีรายการ — กด &quot;เพิ่มรายการ&quot;
                  </td>
                </tr>
              )}
              {lines.map((l) => {
                const qty = lineQty(l); // auto = stock_qty / ratio
                const sum = (Number(l.new_cost) - Number(l.old_cost)) * qty;
                return (
                  <tr key={l.key} className="border-t">
                    <td className="px-2 py-1 font-mono text-xs">{l.item_code}</td>
                    <td className="px-2 py-1">{l.item_name}</td>
                    <td className="px-2 py-1">
                      <div className="flex gap-0.5">
                        <input
                          value={l.wh_code}
                          onChange={(e) =>
                            updateLine(l.key, { wh_code: e.target.value.toUpperCase() })
                          }
                          maxLength={25}
                          className={`${cellInputClass} flex-1`}
                        />
                        <button
                          type="button"
                          onClick={() => openWhPicker({ lineKey: l.key })}
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
                            updateLine(l.key, { shelf_code: e.target.value.toUpperCase() })
                          }
                          maxLength={25}
                          className={`${cellInputClass} flex-1`}
                        />
                        <button
                          type="button"
                          onClick={() => openShelfPicker({ lineKey: l.key })}
                          className="rounded border border-gray-200 px-1.5 text-gray-500 hover:bg-purple-50 hover:text-purple-600"
                          title="ค้นหาพื้นที่"
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
                    <td className="px-2 py-1 text-right text-gray-700">
                      <div className="flex items-center justify-end gap-1">
                        <span title={`คงเหลือในหน่วย ${l.unit_standard}`}>
                          {formatMoney(l.stock_qty)} {l.unit_standard}
                        </span>
                        <button
                          type="button"
                          onClick={() => void refreshStock(l)}
                          title="โหลดใหม่"
                          className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                        >
                          <RefreshCw className="h-3 w-3" />
                        </button>
                      </div>
                      {l.unit_code !== l.unit_standard && (
                        <div className="text-[10px] text-gray-400">
                          = {formatMoney(qty)} {l.unit_code}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-1 text-right text-gray-700">
                      {formatMoney(l.old_cost)}
                    </td>
                    <td className="px-2 py-1">
                      <input
                        type="number"
                        step="0.00001"
                        min="0"
                        value={l.new_cost}
                        onChange={(e) =>
                          updateLine(l.key, { new_cost: Number(e.target.value) || 0 })
                        }
                        className={`${cellInputClass} text-right`}
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
                  <td colSpan={8} className="px-2 py-2 text-right font-semibold text-gray-700">
                    รวมมูลค่า
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
          {isSaving ? 'กำลังบันทึก...' : 'บันทึก (F12)'}
        </button>
      </div>

      <ItemPickerModal
        key={`picker-${pickerKey}`}
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={onPickItem}
      />

      <ImportModal
        open={importOpen}
        whCode={whFrom}
        shelfCode={locationFrom}
        onClose={() => setImportOpen(false)}
        onImport={onImport}
      />

      <LookupPickerModal
        key={`lookup-${lookupKey}`}
        open={lookupOpen}
        title={lookupTitle}
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
