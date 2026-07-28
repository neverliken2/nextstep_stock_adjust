'use server';

/**
 * Server Actions สำหรับเอกสารปรับปรุงสินค้า (Stock Adjust, IA)
 *
 * Post-migration: ไม่ต่อ pg ตรงแล้ว → เรียก smlnesservice (HTTPS)
 *
 * Endpoint mapping (ตาม docs/smlnesservice-migration-plan.md):
 *   searchItems         → GET  /api/v1/stock-adjust/items
 *   getItemDefaults     → GET  /api/v1/stock-adjust/items/:itemCode?whCode
 *   searchWarehouses    → GET  /api/v1/stock-adjust/warehouses?query
 *   searchShelves       → GET  /api/v1/stock-adjust/shelves?query&whCode
 *   getErpOption        → GET  /api/v1/erp-option        (core)
 *   getPurchaseHistory  → GET  /api/v1/stock-adjust/purchase-history/:itemCode
 *   validateImport      → POST /api/v1/stock-adjust/validate-import
 *   saveStockAdjust     → POST /api/v1/stock-adjust
 *
 * Action signatures + return shapes คงเดิม (เพื่อ backward compat กับ UI/components)
 *
 * trans_flag = 66 (สินค้า_ปรับปรุงสต็อก)
 * doc_format_code = 'IA'
 * trans_type = 3 (Inventory)
 * inquiry_type = 0 (1.ปรับปรุงสินค้า)
 *
 * สูตรมูลค่า:
 *   user กรอก = "ทุนเฉลี่ยที่ต้องการให้เป็น" (target_avg) — ใช้ field new_cost เก็บค่านี้
 *   sum_amount = (target_avg − ทุนเดิม) × จำนวน = (new_cost − old_cost) × qty
 * ตัวอย่าง: old=438.59, target=450, qty=21 → sum_amount=239.61 → avg ใหม่=450.00
 */

import {
  apiGet,
  apiPost,
  ApiCallError,
  ApiTransportError,
} from '@/lib/api-client';
import { getSessionToken } from '@/lib/auth-server';

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

/** 1 บรรทัดของเอกสาร IS (ตัดสต็อกออก) — ต่างจาก IA ตรงที่มี qty + price จริง */
export interface StockReduceLinePayload {
  item_code: string;
  item_name: string;
  unit_code: string;
  /** จำนวนที่ตัดออก (บวกเสมอ) */
  qty: number;
  /** ทุนเฉลี่ยปัจจุบันของ (item, wh, shelf) นั้น */
  price: number;
  /** qty × price (บวกเสมอ) */
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

/** Payload ของเอกสาร IS — header เหมือน IA ต่างแค่ shape ของ lines */
export interface StockReducePayload
  extends Omit<StockAdjustPayload, 'lines'> {
  lines: StockReduceLinePayload[];
}

export interface SaveResult {
  success: boolean;
  message: string;
  doc_no?: string;
}

export interface ItemSearchResult {
  rows: ItemOption[];
  has_more: boolean;
}

export interface ErpOption {
  vat_rate: number;
  item_amount_decimal: number;
}

export interface PurchaseHistoryRow {
  doc_no: string;
  doc_date: string;
  vendor_code: string;
  vendor_name: string;
  qty: number;
  price: number;
  unit_code: string;
  vat_type: number;
}

export interface PurchaseHistoryResult {
  rows: PurchaseHistoryRow[];
  has_more: boolean;
}

export interface ItemLocation {
  wh_code: string;
  wh_name: string;
  shelf_code: string;
  shelf_name: string;
  stock_qty: number; // ใน unit_standard
  old_cost: number;
}

export interface ItemLocationsResult {
  success: boolean;
  message?: string;
  item?: ItemOption;
  units?: UnitOption[];
  locations: ItemLocation[];
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
  units?: UnitOption[];
}

export interface ValidateImportResult {
  success: boolean;
  message?: string;
  rows: ValidatedImportRow[];
  total: number;
  ok_count: number;
  error_count: number;
}

// ==================== smlnesservice response shapes (internal) ====================

interface SmlnesSaveResult {
  doc_no: string;
  total_amount: number;
}

// ==================== Helpers ====================

function mapApiError(err: unknown, fallback = 'เกิดข้อผิดพลาด'): string {
  if (err instanceof ApiCallError) {
    switch (err.code) {
      case 'UNAUTHORIZED':
      case 'TOKEN_EXPIRED':
        return 'Session หมดอายุ — กรุณา login ใหม่';
      case 'DATABASE_NOT_FOUND':
        return 'กรุณาเลือกฐานข้อมูลก่อน';
      case 'DOC_FORMAT_NOT_FOUND':
        // message จาก smlnesservice ระบุ code ที่หาไม่เจอมาแล้ว (IA / IS / RMB)
        return err.message || 'ไม่พบ doc_format ในระบบ — กรุณาเพิ่ม code ใน erp_doc_format';
      case 'DUPLICATE_DOC_NO':
        return 'เลขที่เอกสารซ้ำ — กรุณาลองใหม่';
      case 'EMPTY_LINES':
        return 'ไม่มีรายการสินค้า';
      case 'ZERO_AMOUNT':
        return 'มูลค่ารวมเท่ากับ 0';
      case 'NO_PERMISSION':
        return err.message || 'ไม่มีสิทธิ์ใช้งานเมนูนี้';
      case 'ITEM_NOT_FOUND':
        return 'ไม่พบรหัสสินค้า';
      case 'UNIT_NOT_FOUND':
        return 'ไม่พบหน่วยนับ';
      default:
        return err.message || fallback;
    }
  }
  if (err instanceof ApiTransportError) {
    return 'เชื่อมต่อ smlnesservice ไม่ได้';
  }
  if (err instanceof Error) return err.message;
  return fallback;
}

// ==================== 1. Search Items ====================

export async function searchItems(
  query: string,
  offset: number = 0,
  limit: number = 30,
): Promise<ItemSearchResult> {
  const bearer = await getSessionToken();
  if (!bearer) return { rows: [], has_more: false };

  try {
    return await apiGet<ItemSearchResult>(
      '/api/v1/stock-adjust/items',
      bearer,
      { query, offset, limit },
    );
  } catch (err) {
    console.error('searchItems error:', mapApiError(err));
    return { rows: [], has_more: false };
  }
}

// ==================== 2. Get Item Defaults ====================

export async function getItemDefaults(
  itemCode: string,
  whCode: string,
  shelfCode: string = '',
): Promise<ItemDefaultsResult> {
  const bearer = await getSessionToken();
  if (!bearer) {
    return { success: false, message: 'Session หมดอายุ — กรุณา login ใหม่' };
  }

  try {
    const data = await apiGet<{
      item: ItemOption | null;
      units: UnitOption[];
      stock_qty: number;
    }>(
      `/api/v1/stock-adjust/items/${encodeURIComponent(itemCode)}`,
      bearer,
      { whCode, shelfCode },
    );
    return {
      success: true,
      item: data.item || undefined,
      units: data.units,
      stock_qty: data.stock_qty,
    };
  } catch (err) {
    return { success: false, message: mapApiError(err) };
  }
}

// ==================== 3. Search Warehouses ====================

export async function searchWarehouses(query: string): Promise<WarehouseOption[]> {
  const bearer = await getSessionToken();
  if (!bearer) return [];

  try {
    return await apiGet<WarehouseOption[]>(
      '/api/v1/stock-adjust/warehouses',
      bearer,
      { query },
    );
  } catch (err) {
    console.error('searchWarehouses error:', mapApiError(err));
    return [];
  }
}

// ==================== 4. Search Shelves ====================

export async function searchShelves(
  query: string,
  whCode: string,
): Promise<ShelfOption[]> {
  const bearer = await getSessionToken();
  if (!bearer) return [];

  try {
    return await apiGet<ShelfOption[]>(
      '/api/v1/stock-adjust/shelves',
      bearer,
      { query, whCode },
    );
  } catch (err) {
    console.error('searchShelves error:', mapApiError(err));
    return [];
  }
}

// ==================== 5. Get ERP Option ====================

export async function getErpOption(): Promise<ErpOption> {
  const fallback: ErpOption = { vat_rate: 7, item_amount_decimal: 2 };

  const bearer = await getSessionToken();
  if (!bearer) return fallback;

  try {
    return await apiGet<ErpOption>('/api/v1/erp-option', bearer);
  } catch (err) {
    console.error('getErpOption error:', mapApiError(err));
    return fallback;
  }
}

// ==================== 6. Get Purchase History ====================

export async function getPurchaseHistory(
  itemCode: string,
  offset: number,
  limit: number,
): Promise<PurchaseHistoryResult> {
  const empty: PurchaseHistoryResult = { rows: [], has_more: false };

  const bearer = await getSessionToken();
  if (!bearer) return empty;

  try {
    return await apiGet<PurchaseHistoryResult>(
      `/api/v1/stock-adjust/purchase-history/${encodeURIComponent(itemCode)}`,
      bearer,
      { offset, limit },
    );
  } catch (err) {
    console.error('getPurchaseHistory error:', mapApiError(err));
    return empty;
  }
}

// ==================== 7. Validate Import ====================

export async function validateImportRows(
  rows: ImportRowInput[],
  whCode: string,
  shelfCode: string = '',
): Promise<ValidateImportResult> {
  const bearer = await getSessionToken();
  if (!bearer) {
    return {
      success: false,
      message: 'Session หมดอายุ — กรุณา login ใหม่',
      rows: [],
      total: 0,
      ok_count: 0,
      error_count: 0,
    };
  }

  try {
    const data = await apiPost<ValidatedImportRow[]>(
      '/api/v1/stock-adjust/validate-import',
      bearer,
      { rows, wh_code: whCode, shelf_code: shelfCode },
    );
    const ok_count = data.filter((r) => r.valid).length;
    return {
      success: true,
      rows: data,
      total: data.length,
      ok_count,
      error_count: data.length - ok_count,
    };
  } catch (err) {
    return {
      success: false,
      message: mapApiError(err),
      rows: [],
      total: 0,
      ok_count: 0,
      error_count: 0,
    };
  }
}

// ==================== 7.1 Get Item Locations (Bulk by Location) ====================

/**
 * คืน list ของ (wh, shelf) ที่สินค้านี้เคยมี transaction ใน ic_trans_detail
 * พร้อม stock_qty + old_cost ของแต่ละ wh (cache ฝั่ง backend ต่อ wh)
 * — ใช้กับ flow ปรับต้นทุนทุกที่เก็บ (1 ใบต่อ wh+shelf)
 * stock_qty คำนวณสูตรเดียวกับเมนู "ปรับปรุงสินค้า" (getStockAndCost)
 */
export async function getItemLocations(
  itemCode: string,
): Promise<ItemLocationsResult> {
  const bearer = await getSessionToken();
  if (!bearer) {
    return {
      success: false,
      message: 'Session หมดอายุ — กรุณา login ใหม่',
      locations: [],
    };
  }

  try {
    const data = await apiGet<{
      item: ItemOption | null;
      units: UnitOption[];
      locations: ItemLocation[];
    }>(
      `/api/v1/stock-adjust/item-locations/${encodeURIComponent(itemCode)}`,
      bearer,
    );
    return {
      success: true,
      item: data.item || undefined,
      units: data.units,
      locations: data.locations || [],
    };
  } catch (err) {
    return { success: false, message: mapApiError(err), locations: [] };
  }
}

// ==================== 8. Save Stock Adjust ====================

export async function saveStockAdjust(
  payload: StockAdjustPayload,
): Promise<SaveResult> {
  const bearer = await getSessionToken();
  if (!bearer) {
    return { success: false, message: 'Session หมดอายุ — กรุณา login ใหม่' };
  }

  try {
    const data = await apiPost<SmlnesSaveResult>(
      '/api/v1/stock-adjust',
      bearer,
      payload,
    );
    return {
      success: true,
      message: 'บันทึกเอกสารสำเร็จ',
      doc_no: data.doc_no,
    };
  } catch (err) {
    return { success: false, message: mapApiError(err) };
  }
}

// ==================== 9. Save Stock Reduce (ตัดสต็อก — IS, trans_flag=68) ====================

/**
 * บันทึกเอกสาร IS — ตัดสต็อกออก (smlnesservice ≥ 0.8.0)
 *
 * backend INSERT ด้วย trans_flag=68 / doc_format 'IS' / **calc_flag=−1**
 * ทำให้ทั้งจำนวนคงเหลือและมูลค่าลดลง
 *
 * ⚠️ `qty` / `price` / `sum_amount` ต้องเป็นค่าบวกทั้งหมด
 *    (calc_flag=−1 จะพาไปหักออกเอง — ถ้าส่งค่าลบจะกลายเป็นเพิ่มสต็อกแทน)
 *    backend reject ด้วย VALIDATION_ERROR ถ้าเจอค่า ≤ 0
 *
 * ต้องมีสิทธิ์ menu_ic_stk_adjust_subtract — ไม่งั้นได้ NO_PERMISSION
 */
export async function saveStockAdjustReduce(
  payload: StockReducePayload,
): Promise<SaveResult> {
  const bearer = await getSessionToken();
  if (!bearer) {
    return { success: false, message: 'Session หมดอายุ — กรุณา login ใหม่' };
  }

  try {
    const data = await apiPost<SmlnesSaveResult>(
      '/api/v1/stock-adjust/reduce',
      bearer,
      payload,
    );
    return {
      success: true,
      message: 'บันทึกเอกสารสำเร็จ',
      doc_no: data.doc_no,
    };
  } catch (err) {
    return { success: false, message: mapApiError(err) };
  }
}
