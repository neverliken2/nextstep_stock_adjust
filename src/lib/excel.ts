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

/**
 * แถว import ของเมนู "ปรับปรุงสต็อกสินค้า (ลด)" — ตัดสต็อกออก (IS)
 * ไม่มีคลัง/ที่เก็บ — ระบุจำนวนรวม แล้วให้หน้าจอไล่ตัดจากที่เก็บที่มีของมากสุดก่อน
 * ทุน/หน่วยดึงจากทุนเฉลี่ยปัจจุบันของแต่ละที่เก็บอัตโนมัติ (ไม่ต้องกรอก)
 */
export interface ReduceImportRow {
  row_index: number;
  item_code: string;
  unit_code: string;
  /** จำนวนรวมที่ต้องการตัดออก (ในหน่วยที่ระบุ) */
  reduce_qty: number;
}

/** แถว import ของเมนู "สินค้า/วัตถุดิบ คงเหลือยกมา" (RMB) */
export interface BalanceImportRow {
  row_index: number;
  item_code: string;
  unit_code: string;
  wh_code: string;
  shelf_code: string;
  qty: number;
  cost: number;
}

export const MAX_IMPORT_ROWS = 1000;
export const MAX_FILE_SIZE_MB = 5;

const HEADERS = ['รหัสสินค้า', 'รหัสหน่วยนับ', 'ทุนเฉลี่ยที่ต้องการ'];

const REDUCE_HEADERS = ['รหัสสินค้า', 'รหัสหน่วยนับ', 'จำนวนที่ลด'];

const BALANCE_HEADERS = [
  'รหัสสินค้า',
  'รหัสหน่วยนับ',
  'คลัง',
  'ที่เก็บ',
  'จำนวน',
  'ต้นทุน/หน่วย',
];

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
  return rowsFromGrid(await gridFromExcel(file));
}

/** Parse .csv/.tsv/.txt → ImportRow[] (auto-detect TAB/comma) */
export async function parseTextFile(file: File): Promise<{
  rows: ImportRow[];
  warning?: string;
}> {
  return rowsFromGrid(await gridFromText(file));
}

// ──────────────────────────── Reduce (IS) import ────────────────────────────

/** เลือก parser จากนามสกุลไฟล์ — สำหรับเมนูตัดสต็อก (3 คอลัมน์) */
export async function parseReduceImportFile(file: File): Promise<{
  rows: ReduceImportRow[];
  warning?: string;
}> {
  const name = file.name.toLowerCase();
  const grid = name.endsWith('.xlsx')
    ? await gridFromExcel(file)
    : TEXT_EXTENSIONS.some((ext) => name.endsWith(ext))
      ? await gridFromText(file)
      : null;
  if (!grid) {
    throw new Error(`รองรับเฉพาะไฟล์ .xlsx / ${TEXT_EXTENSIONS.join(' / ')}`);
  }

  const { rows, warning } = threeColRowsFromGrid(grid, REDUCE_HEADERS);
  return {
    rows: rows.map((r) => ({
      row_index: r.row_index,
      item_code: r.item_code,
      unit_code: r.unit_code,
      reduce_qty: r.value,
    })),
    warning,
  };
}

/** Generate template ตัดสต็อก + trigger browser download */
export function downloadReduceTemplate(): void {
  const data: (string | number)[][] = [
    REDUCE_HEADERS,
    ['01-0086', 'ชิ้น', 10],
    ['01-0009', 'ลัง24', 2],
  ];

  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [{ wch: 18 }, { wch: 14 }, { wch: 12 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Stock_Reduce');

  XLSX.writeFile(wb, 'stock_reduce_template.xlsx');
}

// ──────────────────────────── Balance (RMB) import ────────────────────────────

/** เลือก parser จากนามสกุลไฟล์ — สำหรับเมนูคงเหลือยกมา (4 คอลัมน์) */
export async function parseBalanceImportFile(file: File): Promise<{
  rows: BalanceImportRow[];
  warning?: string;
}> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx')) {
    return balanceRowsFromGrid(await gridFromExcel(file));
  }
  if (TEXT_EXTENSIONS.some((ext) => name.endsWith(ext))) {
    return balanceRowsFromGrid(await gridFromText(file));
  }
  throw new Error(
    `รองรับเฉพาะไฟล์ .xlsx / ${TEXT_EXTENSIONS.join(' / ')}`,
  );
}

/** Generate template คงเหลือยกมา + trigger browser download */
export function downloadBalanceTemplate(): void {
  const data: (string | number)[][] = [
    BALANCE_HEADERS,
    ['01-0086', 'ชิ้น', 'MMA01', 'SH101', 100, 450],
    ['01-0009', 'ลัง24', 'MMA01', 'SH102', 5, 1200],
  ];

  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [
    { wch: 18 },
    { wch: 14 },
    { wch: 10 },
    { wch: 10 },
    { wch: 10 },
    { wch: 12 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Stock_Balance');

  XLSX.writeFile(wb, 'stock_balance_template.xlsx');
}

// ──────────────────────────── Shared grid readers ────────────────────────────

/** อ่าน .xlsx → grid (แถว × คอลัมน์) */
async function gridFromExcel(file: File): Promise<unknown[][]> {
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

  return XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    raw: true,
    defval: '',
  });
}

/** อ่าน .csv/.tsv/.txt → grid (auto-detect TAB/comma) */
async function gridFromText(file: File): Promise<string[][]> {
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

  return lines.map((line) => line.split(delimiter));
}

/** Grid → ImportRow[] (ใช้ร่วมระหว่าง Excel + text parser) */
function rowsFromGrid(raw: unknown[][]): {
  rows: ImportRow[];
  warning?: string;
} {
  const { rows, warning } = threeColRowsFromGrid(raw, HEADERS);
  return {
    rows: rows.map((r) => ({
      row_index: r.row_index,
      item_code: r.item_code,
      unit_code: r.unit_code,
      new_cost: r.value,
    })),
    warning,
  };
}

/**
 * Grid → แถว 3 คอลัมน์ (รหัสสินค้า | หน่วยนับ | ตัวเลข)
 * ใช้ร่วมระหว่างเมนูปรับต้นทุน (ค่าที่ 3 = ทุนเป้า) และเมนูตัดสต็อก (ค่าที่ 3 = จำนวนที่ลด)
 */
function threeColRowsFromGrid(
  raw: unknown[][],
  headers: string[],
): {
  rows: { row_index: number; item_code: string; unit_code: string; value: number }[];
  warning?: string;
} {
  if (raw.length === 0) throw new Error('ไฟล์ว่าง');

  const trim = (v: unknown): string => String(v ?? '').trim();

  // หา header row (row แรกที่ match headers) — รองรับ header ที่มี whitespace
  let headerIdx = -1;
  for (let i = 0; i < Math.min(raw.length, 5); i++) {
    const cells = (raw[i] || []).map(trim);
    if (cells.length >= 3 && headers.every((h, c) => cells[c] === h)) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) {
    throw new Error(`Header ไม่ตรง — แถวแรกต้องเป็น: ${headers.join(' | ')}`);
  }

  const rows: {
    row_index: number;
    item_code: string;
    unit_code: string;
    value: number;
  }[] = [];
  let dataIdx = 0;
  for (let i = headerIdx + 1; i < raw.length; i++) {
    const r = raw[i] || [];
    const itemCode = trim(r[0]);
    const unitCode = trim(r[1]);
    const valueRaw = r[2];

    // skip empty row
    if (
      !itemCode &&
      !unitCode &&
      (valueRaw === '' || valueRaw === null || valueRaw === undefined)
    ) {
      continue;
    }

    dataIdx++;
    const value =
      typeof valueRaw === 'number'
        ? valueRaw
        : parseFloat(String(valueRaw).trim().replace(/,/g, ''));

    rows.push({
      row_index: dataIdx,
      item_code: itemCode,
      unit_code: unitCode,
      value: Number.isFinite(value) ? value : NaN,
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

/** Grid → BalanceImportRow[] (เมนูคงเหลือยกมา — 6 คอลัมน์ รวมคลัง/ที่เก็บ) */
function balanceRowsFromGrid(raw: unknown[][]): {
  rows: BalanceImportRow[];
  warning?: string;
} {
  if (raw.length === 0) throw new Error('ไฟล์ว่าง');

  const trim = (v: unknown): string => String(v ?? '').trim();
  const num = (v: unknown): number =>
    typeof v === 'number'
      ? v
      : parseFloat(String(v).trim().replace(/,/g, ''));

  let headerIdx = -1;
  for (let i = 0; i < Math.min(raw.length, 5); i++) {
    const cells = (raw[i] || []).map(trim);
    if (
      cells.length >= BALANCE_HEADERS.length &&
      BALANCE_HEADERS.every((h, c) => cells[c] === h)
    ) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) {
    throw new Error(
      `Header ไม่ตรง — แถวแรกต้องเป็น: ${BALANCE_HEADERS.join(' | ')}`,
    );
  }

  const rows: BalanceImportRow[] = [];
  let dataIdx = 0;
  for (let i = headerIdx + 1; i < raw.length; i++) {
    const r = raw[i] || [];
    const itemCode = trim(r[0]);
    const unitCode = trim(r[1]);
    const whCode = trim(r[2]);
    const shelfCode = trim(r[3]);
    const qtyRaw = r[4];
    const costRaw = r[5];

    // skip empty row
    if (
      !itemCode &&
      !unitCode &&
      !whCode &&
      !shelfCode &&
      trim(qtyRaw) === '' &&
      trim(costRaw) === ''
    ) {
      continue;
    }

    dataIdx++;
    const qty = num(qtyRaw);
    const cost = num(costRaw);

    rows.push({
      row_index: dataIdx,
      item_code: itemCode,
      unit_code: unitCode,
      wh_code: whCode.toUpperCase(),
      shelf_code: shelfCode.toUpperCase(),
      qty: Number.isFinite(qty) ? qty : NaN,
      cost: Number.isFinite(cost) ? cost : NaN,
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
