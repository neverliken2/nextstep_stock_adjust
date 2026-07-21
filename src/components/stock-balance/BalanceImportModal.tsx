'use client';

import { useRef, useState, useTransition } from 'react';
import { X, Download, Upload, CheckCircle2, XCircle } from 'lucide-react';
import {
  validateBalanceImportRows,
  type ValidatedBalanceRow,
} from '@/actions/stock-balance';
import {
  downloadBalanceTemplate,
  parseBalanceImportFile,
  type BalanceImportRow,
} from '@/lib/excel';

interface Props {
  open: boolean;
  onClose: () => void;
  onImport: (rows: ValidatedBalanceRow[]) => void;
}

type Step = 'idle' | 'parsed' | 'validated';

/**
 * Import modal ของเมนู "สินค้า/วัตถุดิบ คงเหลือยกมา" (RMB)
 * คอลัมน์: รหัสสินค้า | รหัสหน่วยนับ | จำนวน | ต้นทุน/หน่วย
 * ไม่ต้องส่ง wh/shelf — ทั้งใบใช้ค่าจาก header ของฟอร์มหลัก
 */
export default function BalanceImportModal({ open, onClose, onImport }: Props) {
  const [step, setStep] = useState<Step>('idle');
  const [parsedRows, setParsedRows] = useState<BalanceImportRow[]>([]);
  const [validated, setValidated] = useState<ValidatedBalanceRow[]>([]);
  const [okCount, setOkCount] = useState(0);
  const [errorCount, setErrorCount] = useState(0);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [isWorking, startWork] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  function reset() {
    setStep('idle');
    setParsedRows([]);
    setValidated([]);
    setOkCount(0);
    setErrorCount(0);
    setGlobalError(null);
    setWarning(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setGlobalError(null);
    setWarning(null);
    try {
      const { rows, warning: w } = await parseBalanceImportFile(file);
      setParsedRows(rows);
      setValidated(
        rows.map((r) => ({
          row_index: r.row_index,
          item_code: r.item_code,
          unit_code: r.unit_code,
          wh_code: r.wh_code,
          shelf_code: r.shelf_code,
          qty: r.qty,
          cost: r.cost,
          valid: false,
        })),
      );
      setStep('parsed');
      if (w) setWarning(w);
    } catch (err: unknown) {
      setGlobalError(err instanceof Error ? err.message : 'อ่านไฟล์ผิดพลาด');
    }
  }

  function handleValidate() {
    setGlobalError(null);
    startWork(async () => {
      const res = await validateBalanceImportRows(parsedRows);
      if (!res.success) {
        setGlobalError(res.message || 'ตรวจสอบไม่สำเร็จ');
        return;
      }
      setValidated(res.rows);
      setOkCount(res.ok_count);
      setErrorCount(res.error_count);
      setStep('validated');
    });
  }

  function handleImport() {
    // Strict mode: block ถ้ามีบรรทัดผิด
    if (errorCount > 0) {
      setGlobalError('มีบรรทัดผิดพลาด — แก้ไขไฟล์แล้ว upload ใหม่');
      return;
    }
    onImport(validated.filter((v) => v.valid));
    reset();
    onClose();
  }

  const canValidate = step === 'parsed' && parsedRows.length > 0;
  const canImport = step === 'validated' && errorCount === 0 && okCount > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-4xl rounded-xl bg-white shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-lg font-semibold text-gray-900">
            📥 Import คงเหลือยกมา
          </h2>
          <button
            onClick={handleClose}
            className="rounded-lg p-1 text-gray-500 hover:bg-gray-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Toolbar */}
        <div className="border-b p-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={downloadBalanceTemplate}
            className="flex items-center gap-2 rounded-lg border border-purple-300 bg-white px-3 py-2 text-sm font-medium text-purple-700 hover:bg-purple-50"
          >
            <Download className="h-4 w-4" />
            ดาวน์โหลด Template
          </button>

          <label className="flex items-center gap-2 rounded-lg bg-purple-600 px-3 py-2 text-sm font-medium text-white hover:bg-purple-700 cursor-pointer">
            <Upload className="h-4 w-4" />
            เลือกไฟล์ (Excel/CSV/TSV)
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.csv,.tsv,.txt"
              onChange={handleFile}
              className="hidden"
            />
          </label>

          {step !== 'idle' && (
            <button
              type="button"
              onClick={reset}
              className="text-sm text-gray-600 underline hover:text-gray-900"
            >
              เริ่มใหม่
            </button>
          )}
        </div>

        {/* Status bar */}
        {(warning || globalError || step === 'parsed' || step === 'validated') && (
          <div className="border-b px-4 py-2 flex flex-wrap items-center gap-3 text-sm">
            {warning && <span className="text-amber-700">⚠️ {warning}</span>}
            {globalError && <span className="text-red-700">❌ {globalError}</span>}
            {step === 'parsed' && !globalError && (
              <span className="text-gray-700">
                อ่านได้ <b>{parsedRows.length}</b> บรรทัด — กดปุ่ม &quot;ตรวจสอบ&quot;
              </span>
            )}
            {step === 'validated' && (
              <>
                <span className="text-green-700">
                  ✓ ผ่าน <b>{okCount}</b>
                </span>
                <span className="text-red-700">
                  ✗ ผิด <b>{errorCount}</b>
                </span>
              </>
            )}
          </div>
        )}

        {/* Table */}
        <div className="flex-1 overflow-auto p-4">
          {validated.length === 0 && (
            <div className="text-center text-sm text-gray-400 py-12">
              ยังไม่มีข้อมูล — ดาวน์โหลด Template หรือใช้ไฟล์ CSV/TSV ที่มีหัวคอลัมน์ตรงกัน
            </div>
          )}
          {validated.length > 0 && (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 text-xs text-gray-600">
                <tr>
                  <th className="px-2 py-2 text-right w-12">#</th>
                  <th className="px-2 py-2 text-center w-10">สถานะ</th>
                  <th className="px-2 py-2 text-left">รหัสสินค้า</th>
                  <th className="px-2 py-2 text-left">ชื่อสินค้า</th>
                  <th className="px-2 py-2 text-left">คลัง</th>
                  <th className="px-2 py-2 text-left">ที่เก็บ</th>
                  <th className="px-2 py-2 text-left">หน่วย</th>
                  <th className="px-2 py-2 text-right">จำนวน</th>
                  <th className="px-2 py-2 text-right">ต้นทุน/หน่วย</th>
                  <th className="px-2 py-2 text-right">มูลค่า</th>
                  <th className="px-2 py-2 text-left">หมายเหตุ</th>
                </tr>
              </thead>
              <tbody>
                {validated.map((r) => {
                  const sum =
                    r.valid && step === 'validated' ? r.qty * r.cost : 0;
                  return (
                    <tr
                      key={r.row_index}
                      className={`border-t ${r.valid ? '' : step === 'validated' ? 'bg-red-50' : ''}`}
                    >
                      <td className="px-2 py-1 text-right text-gray-400">
                        {r.row_index}
                      </td>
                      <td className="px-2 py-1 text-center">
                        {step !== 'validated' ? (
                          <span className="text-gray-300">⏳</span>
                        ) : r.valid ? (
                          <CheckCircle2 className="inline h-4 w-4 text-green-600" />
                        ) : (
                          <XCircle className="inline h-4 w-4 text-red-600" />
                        )}
                      </td>
                      <td className="px-2 py-1 font-mono text-xs">{r.item_code}</td>
                      <td className="px-2 py-1">{r.item_name || '-'}</td>
                      <td className="px-2 py-1 font-mono text-xs">{r.wh_code}</td>
                      <td className="px-2 py-1 font-mono text-xs">{r.shelf_code}</td>
                      <td className="px-2 py-1">{r.unit_code}</td>
                      <td className="px-2 py-1 text-right">
                        {Number.isFinite(r.qty) ? r.qty.toLocaleString() : '-'}
                      </td>
                      <td className="px-2 py-1 text-right">
                        {Number.isFinite(r.cost) ? r.cost.toFixed(5) : '-'}
                      </td>
                      <td className="px-2 py-1 text-right font-medium">
                        {step === 'validated' && r.valid
                          ? sum.toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 5,
                            })
                          : '-'}
                      </td>
                      <td className="px-2 py-1 text-xs text-red-600">
                        {r.error || ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="border-t p-4 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            ยกเลิก
          </button>
          {step === 'parsed' && (
            <button
              type="button"
              onClick={handleValidate}
              disabled={!canValidate || isWorking}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
            >
              {isWorking ? 'กำลังตรวจสอบ...' : '🔍 ตรวจสอบทั้งหมด'}
            </button>
          )}
          {step === 'validated' && (
            <button
              type="button"
              onClick={handleImport}
              disabled={!canImport}
              className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
              title={
                errorCount > 0
                  ? 'มีบรรทัดผิดพลาด — แก้ไขไฟล์แล้ว upload ใหม่'
                  : ''
              }
            >
              ➕ เพิ่ม {okCount} บรรทัดเข้า Grid
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
