/**
 * Import helpers สำหรับ Stock Adjust
 * - downloadTemplate: gen .xlsx template ให้ user ดาวน์โหลด
 * - parseExcel: อ่าน .xlsx → ImportRow[]
 * - parseTextFile: อ่าน .csv/.tsv/.txt (auto-detect TAB/comma) → ImportRow[]
 * - parseImportFile: เลือก parser จากนามสกุลไฟล์
 *
 * Template format:
 *   col A: รหัสสินค้า          (item_code)
 *   col B: รหัสหน่วยนับ         (unit_code)
 *   col C: ทุนเฉลี่ยที่ต้องการ  (new_cost — เก็บค่า target_avg ที่ user ต้องการให้เป็น)
 */

import * as XLSX from 'xlsx';

export interface ImportRow {
  row_index: number; // 1-based (เริ่มจากบรรทัด data แรก ไม่นับ header)
  item_code: string;
  unit_code: string;
  new_cost: number;
}

export const MAX_IMPORT_ROWS = 1000;
export const MAX_FILE_SIZE_MB = 5;

const HEADERS = ['รหัสสินค้า', 'รหัสหน่วยนับ', 'ทุนเฉลี่ยที่ต้องการ'];

const TEXT_EXTENSIONS = ['.csv', '.tsv', '.txt'] as const;

/** เลือก parser จากนามสกุลไฟล์ — .xlsx → Excel, อื่นๆ → text */
export async function parseImportFile(file: File): Promise<{
  rows: ImportRow[];
  warning?: string;
}> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx')) return parseExcel(file);
  if (TEXT_EXTENSIONS.some((ext) => name.endsWith(ext))) {
    return parseTextFile(file);
  }
  throw new Error(
    `รองรับเฉพาะไฟล์ .xlsx / ${TEXT_EXTENSIONS.join(' / ')}`,
  );
}

/** Generate template + trigger browser download */
export function downloadTemplate(): void {
  const data: (string | number)[][] = [
    HEADERS,
    ['01-0086', 'ชิ้น', 450],
    ['01-0009', 'ลัง24', 1200],
  ];

  const ws = XLSX.utils.aoa_to_sheet(data);
  // กว้าง column ให้อ่านง่าย
  ws['!cols'] = [{ wch: 18 }, { wch: 14 }, { wch: 12 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Stock_Adjust');

  XLSX.writeFile(wb, 'stock_adjust_template.xlsx');
}

/** Parse .xlsx file → ImportRow[] */
export async function parseExcel(file: File): Promise<{
  rows: ImportRow[];
  warning?: string;
}> {
  if (!file.name.toLowerCase().endsWith('.xlsx')) {
    throw new Error('รองรับเฉพาะไฟล์ .xlsx');
  }
  if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
    throw new Error(`ไฟล์ใหญ่เกิน ${MAX_FILE_SIZE_MB}MB`);
  }

  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error('ไม่พบ sheet ในไฟล์');
  const ws = wb.Sheets[sheetName];

  const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    raw: true,
    defval: '',
  });

  return rowsFromGrid(raw);
}

/** Parse .csv/.tsv/.txt → ImportRow[] (auto-detect TAB/comma) */
export async function parseTextFile(file: File): Promise<{
  rows: ImportRow[];
  warning?: string;
}> {
  if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
    throw new Error(`ไฟล์ใหญ่เกิน ${MAX_FILE_SIZE_MB}MB`);
  }

  // read as UTF-8; strip BOM ถ้ามี
  const text = (await file.text()).replace(/^﻿/, '');
  const lines = text.split(/\r?\n/);

  // pick delimiter จากบรรทัดแรกที่ไม่ว่าง
  const firstNonEmpty = lines.find((l) => l.trim().length > 0);
  if (!firstNonEmpty) throw new Error('ไฟล์ว่าง');
  const delimiter = firstNonEmpty.includes('\t')
    ? '\t'
    : firstNonEmpty.includes(',')
      ? ','
      : null;
  if (!delimiter) {
    throw new Error('ไม่พบตัวคั่น (TAB หรือ comma) ในบรรทัดแรก');
  }

  const grid: string[][] = lines.map((line) => line.split(delimiter));
  return rowsFromGrid(grid);
}

/** Grid → ImportRow[] (ใช้ร่วมระหว่าง Excel + text parser) */
function rowsFromGrid(raw: unknown[][]): {
  rows: ImportRow[];
  warning?: string;
} {
  if (raw.length === 0) throw new Error('ไฟล์ว่าง');

  const trim = (v: unknown): string => String(v ?? '').trim();

  // หา header row (row แรกที่ match HEADERS) — รองรับ header ที่มี whitespace
  let headerIdx = -1;
  for (let i = 0; i < Math.min(raw.length, 5); i++) {
    const cells = (raw[i] || []).map(trim);
    if (
      cells.length >= 3 &&
      cells[0] === HEADERS[0] &&
      cells[1] === HEADERS[1] &&
      cells[2] === HEADERS[2]
    ) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) {
    throw new Error(`Header ไม่ตรง — แถวแรกต้องเป็น: ${HEADERS.join(' | ')}`);
  }

  const rows: ImportRow[] = [];
  let dataIdx = 0;
  for (let i = headerIdx + 1; i < raw.length; i++) {
    const r = raw[i] || [];
    const itemCode = trim(r[0]);
    const unitCode = trim(r[1]);
    const newCostRaw = r[2];

    // skip empty row
    if (
      !itemCode &&
      !unitCode &&
      (newCostRaw === '' || newCostRaw === null || newCostRaw === undefined)
    ) {
      continue;
    }

    dataIdx++;
    const newCost =
      typeof newCostRaw === 'number'
        ? newCostRaw
        : parseFloat(String(newCostRaw).trim().replace(/,/g, ''));

    rows.push({
      row_index: dataIdx,
      item_code: itemCode,
      unit_code: unitCode,
      new_cost: Number.isFinite(newCost) ? newCost : NaN,
    });
  }

  let warning: string | undefined;
  if (rows.length > MAX_IMPORT_ROWS) {
    warning = `เกินขีดจำกัด ${MAX_IMPORT_ROWS} บรรทัด — ตัดเหลือ ${MAX_IMPORT_ROWS}`;
    rows.length = MAX_IMPORT_ROWS;
  }
  if (rows.length === 0) {
    throw new Error('ไม่พบบรรทัดข้อมูล');
  }

  return { rows, warning };
}
