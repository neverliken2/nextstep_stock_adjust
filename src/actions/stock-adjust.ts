'use server';

/**
 * Server Actions สำหรับเอกสารปรับปรุงสินค้า (Stock Adjust, IA)
 *
 * trans_flag = 66 (สินค้า_ปรับปรุงสต็อก)
 * doc_format_code = 'IA'
 * trans_type = 3 (Inventory)
 * inquiry_type = 0 (1.ปรับปรุงสินค้า)
 *
 * สูตรมูลค่า (per business request):
 *   user กรอก = "ทุนเฉลี่ยที่ต้องการให้เป็น" (target_avg) — ใช้ field new_cost เก็บค่านี้
 *   sum_amount = (target_avg − ทุนเดิม) × จำนวน = (new_cost − old_cost) × qty
 *
 * ที่มา: IA เป็น value-only adjust (qty คงเดิม) → avg ใหม่ = (old×qty + sum_amount) / qty
 *        ตั้งให้ avg ใหม่ = target → sum_amount = (target − old) × qty
 *
 *   ตัวอย่าง: old=438.59, target=450, qty=21
 *            → sum_amount = (450 − 438.59) × 21 = 239.61
 *            → avg ใหม่   = (9,210.39 + 239.61) / 21 = 450.00 ✓
 */

import { safeQuery, transaction } from '@/lib/db';
import { validateSession } from '@/lib/auth-server';

const IA_TRANS_FLAG = 66;
const TRANS_TYPE_INVENTORY = 3;
const IA_FORMAT_CODE = 'IA';
const INQUIRY_TYPE_NORMAL = 0;
const APP_CREATOR_CODE = 'nextstep_stock_adjust';

// ==================== Types ====================

export interface ItemOption {
  code: string;
  name: string;
  unit_standard: string;
  average_cost: number;
}

export interface UnitOption {
  code: string;
  stand_value: number;
  divide_value: number;
  ratio: number;
}

export interface WarehouseOption {
  code: string;
  name: string;
}

export interface ShelfOption {
  code: string;
  name: string;
  wh_code: string;
}

export interface ItemDefaultsResult {
  success: boolean;
  message?: string;
  item?: ItemOption;
  units?: UnitOption[];
  stock_qty?: number;
}

export interface StockAdjustLinePayload {
  item_code: string;
  item_name: string;
  unit_code: string;
  /** มูลค่ารวมที่จะ INSERT ลง ic_trans_detail.sum_amount (qty/price จะถูก force = 0) */
  sum_amount: number;
  wh_code: string;
  shelf_code: string;
  stand_value: number;
  divide_value: number;
}

export interface StockAdjustPayload {
  doc_date: string;
  doc_time: string;
  doc_ref: string;
  doc_ref_date: string;
  wh_from: string;
  location_from: string;
  remark: string;
  lines: StockAdjustLinePayload[];
}

export interface SaveResult {
  success: boolean;
  message: string;
  doc_no?: string;
}

// ==================== Import Types ====================

export interface ImportRowInput {
  row_index: number;
  item_code: string;
  unit_code: string;
  new_cost: number;
}

export interface ValidatedImportRow {
  row_index: number;
  item_code: string;
  unit_code: string;
  new_cost: number;
  valid: boolean;
  error?: string;
  // ถ้า valid:
  item_name?: string;
  unit_standard?: string;
  old_cost?: number;
  stock_qty?: number;
  stand_value?: number;
  divide_value?: number;
  units?: UnitOption[]; // ทั้งรายการ unit ของสินค้านี้ (ไว้ให้ user เปลี่ยนหลัง import)
}

export interface ValidateImportResult {
  success: boolean;
  message?: string;
  rows: ValidatedImportRow[];
  total: number;
  ok_count: number;
  error_count: number;
}

// ==================== Helpers ====================

async function getAuthorizedDatabase(): Promise<
  { database: string; userCode: string } | { error: string }
> {
  const session = await validateSession();
  if (!session.authenticated || !session.user) {
    return { error: 'Session expired - กรุณา login ใหม่' };
  }
  const database = session.user.selected_database;
  if (!database) {
    return { error: 'กรุณาเลือกฐานข้อมูลก่อน' };
  }
  return { database, userCode: session.user.user_code };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round5(n: number): number {
  return Math.round(n * 100000) / 100000;
}

// ==================== Search Items ====================

export async function searchItems(query: string): Promise<ItemOption[]> {
  const auth = await getAuthorizedDatabase();
  if ('error' in auth) return [];

  const q = (query || '').trim().slice(0, 50);
  const like = `%${q}%`;

  const result = await safeQuery<{
    code: string;
    name_1: string;
    unit_standard: string;
    average_cost: string;
  }>(
    auth.database,
    `SELECT code, name_1, unit_standard, average_cost
     FROM ic_inventory
     WHERE code ILIKE $1 OR name_1 ILIKE $1
     ORDER BY code
     LIMIT 50`,
    [like]
  );

  return result.rows.map((r) => ({
    code: r.code,
    name: (r.name_1 || '').trim(),
    unit_standard: r.unit_standard || '',
    average_cost: Number(r.average_cost) || 0,
  }));
}

// ==================== Get Item Defaults ====================
// คืนค่า: ทุนเดิม + รายการหน่วย + stock คงเหลือใน wh ที่ระบุ

export async function getItemDefaults(
  itemCode: string,
  whCode: string
): Promise<ItemDefaultsResult> {
  const auth = await getAuthorizedDatabase();
  if ('error' in auth) return { success: false, message: auth.error };

  const code = (itemCode || '').trim();
  if (!code) return { success: false, message: 'item_code ว่าง' };

  const itemResult = await safeQuery<{
    code: string;
    name_1: string;
    unit_standard: string;
    average_cost: string;
  }>(
    auth.database,
    `SELECT code, name_1, unit_standard, average_cost
     FROM ic_inventory WHERE code = $1 LIMIT 1`,
    [code]
  );
  if (itemResult.rows.length === 0) {
    return { success: false, message: 'ไม่พบสินค้า' };
  }
  const it = itemResult.rows[0];
  const item: ItemOption = {
    code: it.code,
    name: (it.name_1 || '').trim(),
    unit_standard: it.unit_standard || '',
    average_cost: Number(it.average_cost) || 0,
  };

  const unitResult = await safeQuery<{
    code: string;
    stand_value: string;
    divide_value: string;
    ratio: string;
  }>(
    auth.database,
    `SELECT code, stand_value, divide_value, ratio
     FROM ic_unit_use
     WHERE ic_code = $1 AND COALESCE(status, 1) = 1
     ORDER BY row_order, line_number`,
    [code]
  );
  const units: UnitOption[] = unitResult.rows.map((u) => ({
    code: u.code || '',
    stand_value: Number(u.stand_value) || 1,
    divide_value: Number(u.divide_value) || 1,
    ratio: Number(u.ratio) || 1,
  }));
  if (units.length === 0 && item.unit_standard) {
    units.push({ code: item.unit_standard, stand_value: 1, divide_value: 1, ratio: 1 });
  }

  // stock คงเหลือ + ทุนเดิม (mode "ปกติ")
  // Mirror SMLERPControl._icInfoProcess._stkStockInfoAndBalanceQuery (costMode=ปรกติ)
  // - balance_qty   = SUM(stock movement) ÷ unit_standard_ratio (display in unit_standard)
  // - average_cost_end = ทุนต่อหน่วย จาก trans active ล่าสุด × unit_ratio ของ unit_standard
  const { stockQty, avgCostEnd } = await getStockAndCost(
    auth.database,
    code,
    whCode,
    new Date().toISOString().slice(0, 10) // as-of-date = today
  );

  // override average_cost ด้วย average_cost_end (ทุนเดิมที่ user ต้องการ)
  item.average_cost = avgCostEnd;

  return { success: true, item, units, stock_qty: stockQty };
}

// ==================== Stock + Cost Query (mirror SMLERP "ปกติ" mode) ====================
// แกะมาจาก SMLERPControl._icInfoProcess._stkStockInfoAndBalanceQuery
// Trans flag groups:
//   เข้า: 70,54,60,58,310,12; 66(qty>0); 14(inq=0); 48(inq<2)
//   ออก: 56,68,72,44; 66(qty<0); 46(inq in 0,2); 16(inq in 0,2); 311(inq=0)
//   Exclude: doc_ref<>'' AND is_pos=1
async function getStockAndCost(
  database: string,
  itemCode: string,
  whCode: string,
  asOfDate: string
): Promise<{ stockQty: number; avgCostEnd: number }> {
  if (!itemCode || !whCode) return { stockQty: 0, avgCostEnd: 0 };

  const sql = `
WITH t1 AS (
  SELECT
    item_code AS ic_code,
    wh_code   AS warehouse,
    COALESCE(SUM(calc_flag * (
      CASE WHEN (
        (trans_flag IN (70,54,60,58,310,12)
         OR (trans_flag=66 AND qty>0)
         OR (trans_flag=14 AND inquiry_type=0)
         OR (trans_flag=48 AND inquiry_type<2))
        OR (
          (trans_flag IN (56,68,72,44)
           OR (trans_flag=66 AND qty<0)
           OR (trans_flag=46 AND inquiry_type IN (0,2))
           OR (trans_flag=16 AND inquiry_type IN (0,2))
           OR (trans_flag=311 AND inquiry_type=0))
          AND NOT (ic_trans_detail.doc_ref <> '' AND ic_trans_detail.is_pos = 1)
        )
      ) THEN ROUND((qty*stand_value)::numeric / NULLIF(divide_value,0), 3)
        ELSE 0 END
    )),0) AS balance_qty,
    COALESCE(SUM(calc_flag * (
      CASE WHEN (
        (trans_flag IN (70,54,60,58,310,12)
         OR (trans_flag=66 AND (qty>0 OR sum_of_cost>0))
         OR (trans_flag=14)
         OR (trans_flag=48 AND inquiry_type<2))
        OR (
          (trans_flag IN (56,68,72,44)
           OR (trans_flag=66 AND (qty<0 OR sum_of_cost<0))
           OR (trans_flag=46)
           OR (trans_flag=16)
           OR (trans_flag=311))
          AND NOT (ic_trans_detail.doc_ref <> '' AND ic_trans_detail.is_pos = 1)
        )
      ) THEN CASE WHEN trans_flag=66 AND qty<0
                  THEN (-1 * sum_of_cost) + COALESCE(profit_lost_cost_amount,0)
                  ELSE sum_of_cost + COALESCE(profit_lost_cost_amount,0) END
        ELSE 0 END
    )),0) AS balance_amount
  FROM ic_trans_detail
  WHERE ic_trans_detail.last_status=0
    AND ic_trans_detail.item_type <> 5
    AND ic_trans_detail.is_doc_copy = 0
    AND (SELECT item_type FROM ic_inventory WHERE code = ic_trans_detail.item_code) NOT IN (1,3)
    AND doc_date_calc <= $3
    AND item_code = $1
    AND wh_code = $2
  GROUP BY item_code, wh_code
),
t2 AS (
  SELECT
    t1.*,
    (SELECT NULLIF(unit_standard_stand_value,0)::numeric / NULLIF(unit_standard_divide_value,0)
       FROM ic_inventory WHERE code = t1.ic_code) AS unit_ratio,
    (SELECT NULLIF(stand_value,0)::numeric / NULLIF(divide_value,0)
       FROM ic_unit_use
       WHERE ic_unit_use.ic_code = t1.ic_code
         AND ic_unit_use.code = (SELECT unit_standard FROM ic_inventory WHERE code = t1.ic_code)
       LIMIT 1) AS unit_standard_ratio
  FROM t1
)
SELECT
  COALESCE(balance_qty / NULLIF(COALESCE(unit_standard_ratio,1),0), 0) AS balance_qty_display,
  COALESCE((
    (SELECT average_cost
       FROM ic_trans_detail d
       WHERE d.last_status=0
         AND d.item_code = t2.ic_code
         AND d.doc_date_calc <= $3
         AND (
           (d.trans_flag IN (70,54,60,58,310,12)
            OR (d.trans_flag=66 AND (d.qty>0 OR d.sum_of_cost>0))
            OR (d.trans_flag=14)
            OR (d.trans_flag=48 AND d.inquiry_type<2))
           OR (
             (d.trans_flag IN (56,68,72,44)
              OR (d.trans_flag=66 AND (d.qty<0 OR d.sum_of_cost<0))
              OR (d.trans_flag=46)
              OR (d.trans_flag=16)
              OR (d.trans_flag=311))
             AND NOT (d.doc_ref <> '' AND d.is_pos = 1)
           )
         )
       ORDER BY d.doc_date_calc DESC, d.doc_time DESC, d.line_number DESC
       LIMIT 1
    ) * COALESCE(unit_ratio,1)
  ), 0) AS average_cost_end
FROM t2`;

  const res = await safeQuery<{
    balance_qty_display: string;
    average_cost_end: string;
  }>(database, sql, [itemCode, whCode, asOfDate]);

  if (res.rows.length === 0) return { stockQty: 0, avgCostEnd: 0 };
  return {
    stockQty: Number(res.rows[0].balance_qty_display) || 0,
    avgCostEnd: Number(res.rows[0].average_cost_end) || 0,
  };
}

// ==================== Search Warehouses ====================

export async function searchWarehouses(query: string): Promise<WarehouseOption[]> {
  const auth = await getAuthorizedDatabase();
  if ('error' in auth) return [];

  const q = (query || '').trim().slice(0, 50);
  const like = `%${q}%`;

  const result = await safeQuery<{ code: string; name_1: string }>(
    auth.database,
    `SELECT code, name_1
     FROM ic_warehouse
     WHERE code ILIKE $1 OR name_1 ILIKE $1
     ORDER BY code
     LIMIT 100`,
    [like]
  );
  return result.rows.map((r) => ({ code: r.code, name: (r.name_1 || '').trim() }));
}

// ==================== Search Shelves ====================

export async function searchShelves(
  query: string,
  whCode: string
): Promise<ShelfOption[]> {
  const auth = await getAuthorizedDatabase();
  if ('error' in auth) return [];

  const q = (query || '').trim().slice(0, 50);
  const like = `%${q}%`;
  const wh = (whCode || '').trim();

  const params: (string | number)[] = [like];
  let whClause = '';
  if (wh) {
    params.push(wh);
    whClause = ` AND whcode = $${params.length}`;
  }
  const result = await safeQuery<{ code: string; name_1: string; whcode: string }>(
    auth.database,
    `SELECT code, name_1, whcode
     FROM ic_shelf
     WHERE (code ILIKE $1 OR name_1 ILIKE $1)${whClause}
     ORDER BY code
     LIMIT 100`,
    params
  );
  return result.rows.map((r) => ({
    code: r.code,
    name: (r.name_1 || '').trim(),
    wh_code: r.whcode || '',
  }));
}

// ==================== Validate Import Rows ====================
// Batch validation สำหรับ Excel import
// - ดึง item + unit + cost + stock ทุกบรรทัดในรอบเดียว (efficient)
// - Strict mode: คืนผลทุกบรรทัด แต่ frontend จะ block save ถ้ามีบรรทัดผิด

export async function validateImportRows(
  rows: ImportRowInput[],
  whCode: string
): Promise<ValidateImportResult> {
  const auth = await getAuthorizedDatabase();
  if ('error' in auth) {
    return { success: false, message: auth.error, rows: [], total: 0, ok_count: 0, error_count: 0 };
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    return { success: false, message: 'ไม่มีบรรทัดข้อมูล', rows: [], total: 0, ok_count: 0, error_count: 0 };
  }
  if (rows.length > 1000) {
    return {
      success: false,
      message: 'เกินขีดจำกัด 1,000 บรรทัด',
      rows: [], total: 0, ok_count: 0, error_count: 0
    };
  }
  if (!whCode) {
    return {
      success: false,
      message: 'กรุณาระบุคลังในหน้า header ก่อน import',
      rows: [], total: 0, ok_count: 0, error_count: 0
    };
  }

  // ── Batch 1: ดึง item master ที่ unique ทั้งหมด ──
  const itemCodes = Array.from(new Set(rows.map((r) => (r.item_code || '').trim()).filter(Boolean)));
  const itemMap = new Map<string, { name: string; unit_standard: string }>();
  if (itemCodes.length > 0) {
    const itemRes = await safeQuery<{ code: string; name_1: string; unit_standard: string }>(
      auth.database,
      `SELECT code, name_1, unit_standard FROM ic_inventory WHERE code = ANY($1::text[])`,
      [`{${itemCodes.map((c) => `"${c.replace(/"/g, '\\"')}"`).join(',')}}`]
    );
    for (const r of itemRes.rows) {
      itemMap.set(r.code, {
        name: (r.name_1 || '').trim(),
        unit_standard: r.unit_standard || '',
      });
    }
  }

  // ── Batch 2: ดึง unit_use ของทุก item ที่ unique ──
  // (per item อาจมีหลาย unit — เก็บเป็น Map<item_code, UnitOption[]>)
  const unitMap = new Map<string, UnitOption[]>();
  if (itemCodes.length > 0) {
    const unitRes = await safeQuery<{
      ic_code: string;
      code: string;
      stand_value: string;
      divide_value: string;
      ratio: string;
    }>(
      auth.database,
      `SELECT ic_code, code, stand_value, divide_value, ratio
         FROM ic_unit_use
         WHERE ic_code = ANY($1::text[]) AND COALESCE(status, 1) = 1
         ORDER BY ic_code, row_order, line_number`,
      [`{${itemCodes.map((c) => `"${c.replace(/"/g, '\\"')}"`).join(',')}}`]
    );
    for (const u of unitRes.rows) {
      const list = unitMap.get(u.ic_code) || [];
      list.push({
        code: u.code || '',
        stand_value: Number(u.stand_value) || 1,
        divide_value: Number(u.divide_value) || 1,
        ratio: Number(u.ratio) || 1,
      });
      unitMap.set(u.ic_code, list);
    }
  }

  // ── Per-row: cost + stock (run concurrent, แต่ limit) ──
  const asOfDate = new Date().toISOString().slice(0, 10);
  const validated: ValidatedImportRow[] = [];

  // pre-validate (sync) + collect ones that need cost/stock query
  type NeedQuery = { row: ValidatedImportRow; itemCode: string };
  const needs: NeedQuery[] = [];

  for (const r of rows) {
    const item_code = (r.item_code || '').trim();
    const unit_code = (r.unit_code || '').trim();
    const new_cost = Number(r.new_cost);

    const out: ValidatedImportRow = {
      row_index: r.row_index,
      item_code,
      unit_code,
      new_cost,
      valid: false,
    };

    // basic checks
    if (!item_code) { out.error = 'รหัสสินค้าว่าง'; validated.push(out); continue; }
    if (!unit_code) { out.error = 'หน่วยว่าง'; validated.push(out); continue; }
    if (!Number.isFinite(new_cost)) { out.error = 'ทุนเฉลี่ยที่ต้องการผิด format'; validated.push(out); continue; }
    if (new_cost < 0) { out.error = 'ต้นทุนติดลบ'; validated.push(out); continue; }

    const item = itemMap.get(item_code);
    if (!item) { out.error = 'ไม่พบสินค้า'; validated.push(out); continue; }

    const units = unitMap.get(item_code) || [];
    const unit = units.find((u) => u.code === unit_code);
    if (!unit) {
      out.error = `หน่วย "${unit_code}" ไม่ตรงกับสินค้า ${item_code}`;
      out.item_name = item.name;
      out.unit_standard = item.unit_standard;
      out.units = units;
      validated.push(out);
      continue;
    }

    // basic OK → ต้อง query cost/stock ต่อ
    out.item_name = item.name;
    out.unit_standard = item.unit_standard;
    out.units = units;
    out.stand_value = unit.stand_value;
    out.divide_value = unit.divide_value;
    validated.push(out);
    needs.push({ row: out, itemCode: item_code });
  }

  // concurrent query (batch ละ 10) — กัน DB overload
  const BATCH = 10;
  for (let i = 0; i < needs.length; i += BATCH) {
    const slice = needs.slice(i, i + BATCH);
    await Promise.all(
      slice.map(async ({ row, itemCode }) => {
        try {
          const { stockQty, avgCostEnd } = await getStockAndCost(
            auth.database,
            itemCode,
            whCode,
            asOfDate
          );
          row.old_cost = avgCostEnd;
          row.stock_qty = stockQty;
          row.valid = true;
        } catch (e: unknown) {
          row.error = `query stock ผิดพลาด: ${e instanceof Error ? e.message : 'unknown'}`;
        }
      })
    );
  }

  const ok = validated.filter((v) => v.valid).length;
  return {
    success: true,
    rows: validated,
    total: validated.length,
    ok_count: ok,
    error_count: validated.length - ok,
  };
}

// ==================== Save Stock Adjust ====================

export async function saveStockAdjust(payload: StockAdjustPayload): Promise<SaveResult> {
  const auth = await getAuthorizedDatabase();
  if ('error' in auth) return { success: false, message: auth.error };

  if (!payload.doc_date) return { success: false, message: 'กรุณาระบุวันที่' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.doc_date)) {
    return { success: false, message: 'รูปแบบวันที่ไม่ถูกต้อง (YYYY-MM-DD)' };
  }
  if (payload.doc_ref_date && !/^\d{4}-\d{2}-\d{2}$/.test(payload.doc_ref_date)) {
    return { success: false, message: 'รูปแบบวันที่อ้างอิงไม่ถูกต้อง (YYYY-MM-DD)' };
  }
  if (!payload.wh_from) return { success: false, message: 'กรุณาระบุคลัง' };

  const validLines = (payload.lines || []).filter(
    (l) => l.item_code && Number(l.sum_amount) !== 0
  );
  if (validLines.length === 0) {
    return { success: false, message: 'กรุณาเพิ่มรายการสินค้าอย่างน้อย 1 รายการ' };
  }

  for (const l of validLines) {
    if (!Number.isFinite(l.sum_amount)) {
      return { success: false, message: `มูลค่าไม่ถูกต้อง: ${l.item_code}` };
    }
    if (!l.unit_code) {
      return { success: false, message: `กรุณาเลือกหน่วยของสินค้า: ${l.item_code}` };
    }
  }

  const docTime =
    payload.doc_time && /^\d{2}:\d{2}$/.test(payload.doc_time)
      ? payload.doc_time
      : (() => {
          const n = new Date();
          return `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`;
        })();

  try {
    const result = await transaction(auth.database, async (client) => {
      // หมายเหตุ: ไม่ตรวจ stock เพราะ qty=0 (เป็น value-only adjustment)

      // ── Generate doc_no in-tx (lock erp_doc_format row) ──
      const fmtRes = await client.query<{ format: string }>(
        `SELECT format FROM erp_doc_format WHERE code = $1 LIMIT 1 FOR UPDATE`,
        [IA_FORMAT_CODE]
      );
      if (fmtRes.rows.length === 0) {
        throw new Error(`ไม่พบ doc_format "${IA_FORMAT_CODE}" ใน erp_doc_format`);
      }
      const format = fmtRes.rows[0].format || '';
      if (!format) throw new Error('format ของ doc_format ว่าง');

      const runMatch = /(#+)/.exec(format);
      if (!runMatch) throw new Error(`format "${format}" ไม่มี # สำหรับ running`);
      const digitCount = runMatch[1].length;
      const beforeRun = format.slice(0, runMatch.index);
      const afterRun = format.slice(runMatch.index + digitCount);

      const [yyyy, mm, dd] = payload.doc_date.split('-');
      const yy = yyyy.slice(-2);
      const expand = (tpl: string) =>
        tpl
          .replace(/@/g, IA_FORMAT_CODE)
          .replace(/YYYY/g, yyyy)
          .replace(/YY/g, yy)
          .replace(/MM/g, mm)
          .replace(/DD/g, dd);
      const prefix = expand(beforeRun);
      const suffix = expand(afterRun);
      const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pgPattern = `^${escapeRegex(prefix)}[0-9]{${digitCount}}${escapeRegex(suffix)}$`;

      const lastRes = await client.query<{ doc_no: string }>(
        `SELECT doc_no FROM ic_trans
         WHERE trans_flag = $1 AND doc_format_code = $2 AND doc_no ~ $3
         ORDER BY doc_no DESC LIMIT 1`,
        [IA_TRANS_FLAG, IA_FORMAT_CODE, pgPattern]
      );
      let nextRunning = 1;
      if (lastRes.rows.length > 0) {
        const digits = lastRes.rows[0].doc_no.slice(
          prefix.length,
          prefix.length + digitCount
        );
        const parsed = parseInt(digits, 10);
        if (!Number.isNaN(parsed)) nextRunning = parsed + 1;
      }
      const docNo = prefix + String(nextRunning).padStart(digitCount, '0') + suffix;

      const dup = await client.query(
        `SELECT doc_no FROM ic_trans WHERE trans_flag = $1 AND doc_no = $2 LIMIT 1`,
        [IA_TRANS_FLAG, docNo]
      );
      if (dup.rows.length > 0) {
        throw new Error(`เลขที่เอกสาร ${docNo} ซ้ำ — กรุณาลองใหม่`);
      }

      // ── เตรียมข้อมูล: qty/price = 0, sum_amount = ค่าจาก client (value-only adjust) ──
      type ComputedLine = StockAdjustLinePayload & {
        sum_amount_rounded: number;
      };
      const computed: ComputedLine[] = validLines.map((l) => ({
        ...l,
        wh_code: l.wh_code || payload.wh_from,
        shelf_code: l.shelf_code || payload.location_from,
        sum_amount_rounded: round5(Number(l.sum_amount)),
      }));
      const totalAmount = round2(
        computed.reduce((s, l) => s + l.sum_amount_rounded, 0)
      );

      // helper: ถ้า string ว่าง → null (ตรงกับ pattern ของ smlerp22)
      const nullIfEmpty = (s: string | null | undefined): string | null => {
        if (s === null || s === undefined) return null;
        const t = String(s).trim();
        return t === '' ? null : t;
      };

      // ── INSERT ic_trans (header) ──
      await client.query(
        `INSERT INTO ic_trans (
           trans_type, trans_flag,
           doc_date, doc_no, doc_format_code, doc_time,
           doc_ref, doc_ref_date,
           inquiry_type,
           total_amount,
           wh_from, location_from,
           branch_code,
           remark,
           status, last_status, used_status, used_status_2, doc_success,
           creator_code, last_editor_code,
           create_datetime, create_date_time_now
         ) VALUES (
           $1, $2,
           $3, $4, $5, $6,
           $7, $8,
           $9,
           $10,
           $11, $12,
           $13,
           $14,
           0, 0, 0, 0, 0,
           $15, $15,
           NOW(), NOW()
         )`,
        [
          TRANS_TYPE_INVENTORY,
          IA_TRANS_FLAG,
          payload.doc_date,
          docNo,
          IA_FORMAT_CODE,
          docTime,
          nullIfEmpty(payload.doc_ref?.slice(0, 255)),
          payload.doc_ref_date || null,
          INQUIRY_TYPE_NORMAL,
          totalAmount,
          (payload.wh_from || '').slice(0, 25),
          (payload.location_from || '').slice(0, 25),
          '0000', // branch_code = default 0000 (ตาม smlerp pattern)
          nullIfEmpty(payload.remark?.slice(0, 255)),
          APP_CREATOR_CODE,
        ]
      );

      // ── INSERT ic_trans_detail (lines) ──
      // Match smlerp pattern:
      //  ratio = 0 (smlerp ตั้งใจ set 0 แม้ stand/divide จะมีค่า)
      //  is_get_price = 1 (บอกว่า "ดึงราคาแล้ว")
      //  ref_row = -1 (default สำหรับเอกสารที่ไม่มี ref)
      //  branch_code = '0000' (default สาขา)
      //  price_type, price_mode → null (smlerp ไม่ set)
      let lineNo = 0;
      for (const ln of computed) {
        await client.query(
          `INSERT INTO ic_trans_detail (
             trans_type, trans_flag,
             doc_date, doc_no, doc_time,
             line_number,
             item_code, item_name, unit_code,
             qty, price,
             sum_amount, sum_of_cost, sum_amount_exclude_vat,
             sum_of_cost_1, average_cost, average_cost_1,
             wh_code, shelf_code, branch_code,
             stand_value, divide_value, ratio,
             calc_flag, vat_type, item_type, inquiry_type,
             is_get_price, ref_row,
             price_type, price_mode,
             status, last_status,
             doc_date_calc, doc_time_calc,
             creator_code, last_editor_code,
             create_date_time_now
           ) VALUES (
             $1, $2,
             $3, $4, $5,
             $6,
             $7, $8, $9,
             $10, $11,
             $12, $12, $12,
             $12, $11, $11,
             $13, $14, $15,
             $16, $17, 0,
             1, 0, 0, $18,
             1, -1,
             NULL, NULL,
             0, 0,
             $3, $5,
             $19, $19,
             NOW()
           )`,
          [
            TRANS_TYPE_INVENTORY,                              // $1
            IA_TRANS_FLAG,                                     // $2
            payload.doc_date,                                  // $3
            docNo,                                             // $4
            docTime,                                           // $5
            lineNo,                                            // $6
            ln.item_code,                                      // $7
            (ln.item_name || '').slice(0, 200),                // $8
            ln.unit_code,                                      // $9
            0,                                                  // $10 qty = 0 (value-only adjust)
            0,                                                  // $11 price = 0 (avg_cost ก็ 0)
            ln.sum_amount_rounded,                             // $12 sum_amount (รวมมูลค่า)
            (ln.wh_code || '').slice(0, 25),                   // $13
            (ln.shelf_code || '').slice(0, 25),                // $14
            '0000',                                             // $15 branch_code = default
            ln.stand_value,                                    // $16
            ln.divide_value,                                   // $17
            INQUIRY_TYPE_NORMAL,                               // $18
            APP_CREATOR_CODE,                                  // $19
          ]
        );
        lineNo++;
      }

      return { doc_no: docNo };
    });

    return {
      success: true,
      message: `บันทึกเอกสาร ${result.doc_no} สำเร็จ`,
      doc_no: result.doc_no,
    };
  } catch (error: unknown) {
    console.error('saveStockAdjust error:', error);
    const msg = error instanceof Error ? error.message : 'เกิดข้อผิดพลาด';
    return { success: false, message: msg };
  }
}
