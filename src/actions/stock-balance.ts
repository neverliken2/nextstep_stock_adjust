'use server';

/**
 * Server Actions สำหรับเอกสารสินค้า/วัตถุดิบ คงเหลือยกมา (Stock Balance, RMB)
 *
 * Endpoint mapping (smlnesservice):
 *   validateBalanceImportRows → POST /api/v1/stock-adjust/validate-import-balance
 *   saveStockBalance          → POST /api/v1/stock-adjust/balance
 *
 * trans_flag = 54 (สินค้า_ยอดคงเหลือสินค้ายกมา)
 * doc_format_code = 'RMB'
 * trans_type = 3 (Inventory)
 *
 * ต่างจาก IA: line เก็บ qty จริง + price (ต้นทุน/หน่วย)
 *   sum_amount = qty × price (server คำนวณ)
 * ทั้งใบใช้ คลัง/ที่เก็บ จาก header (wh_from/location_from)
 */

import {
  apiPost,
  ApiCallError,
  ApiTransportError,
} from '@/lib/api-client';
import { getSessionToken } from '@/lib/auth-server';
import type { UnitOption } from '@/actions/stock-adjust';

// ==================== Types ====================

export interface StockBalanceLinePayload {
  item_code: string;
  item_name: string;
  unit_code: string;
  qty: number;
  /** ต้นทุน/หน่วย (ในหน่วย unit_code ที่เลือก) */
  price: number;
  wh_code: string;
  shelf_code: string;
  stand_value: number;
  divide_value: number;
}

export interface StockBalancePayload {
  doc_date: string;
  doc_time: string;
  doc_ref: string;
  doc_ref_date: string;
  wh_from: string;
  location_from: string;
  remark: string;
  lines: StockBalanceLinePayload[];
}

export interface SaveBalanceResult {
  success: boolean;
  message: string;
  doc_no?: string;
}

// ==================== Import Types ====================

export interface BalanceImportRowInput {
  row_index: number;
  item_code: string;
  unit_code: string;
  wh_code: string;
  shelf_code: string;
  qty: number;
  cost: number;
}

export interface ValidatedBalanceRow {
  row_index: number;
  item_code: string;
  unit_code: string;
  wh_code: string;
  shelf_code: string;
  qty: number;
  cost: number;
  valid: boolean;
  error?: string;
  // ถ้า valid:
  item_name?: string;
  unit_standard?: string;
  stand_value?: number;
  divide_value?: number;
  units?: UnitOption[];
}

export interface ValidateBalanceImportResult {
  success: boolean;
  message?: string;
  rows: ValidatedBalanceRow[];
  total: number;
  ok_count: number;
  error_count: number;
}

// ==================== smlnesservice response shapes (internal) ====================

interface SmlnesSaveResult {
  doc_no: string;
  total_amount: number;
}

interface SmlnesValidateResult {
  rows: ValidatedBalanceRow[];
  total: number;
  ok_count: number;
  error_count: number;
}

// ==================== Helpers ====================

function mapApiError(err: unknown, fallback = 'เกิดข้อผิดพลาด'): string {
  if (err instanceof ApiCallError) {
    switch (err.code) {
      case 'UNAUTHORIZED':
      case 'TOKEN_EXPIRED':
        return 'Session หมดอายุ — กรุณา login ใหม่';
      case 'NO_PERMISSION':
        return 'ไม่มีสิทธิ์เมนู "สินค้า/วัตถุดิบ คงเหลือยกมา" — ติดต่อ admin กำหนดสิทธิ์ใน SML';
      case 'DATABASE_NOT_FOUND':
        return 'กรุณาเลือกฐานข้อมูลก่อน';
      case 'DOC_FORMAT_NOT_FOUND':
        return 'ไม่พบ doc_format "RMB" ในระบบ — กรุณาเพิ่ม code RMB ใน erp_doc_format';
      case 'DUPLICATE_DOC_NO':
        return 'เลขที่เอกสารซ้ำ — กรุณาลองใหม่';
      case 'EMPTY_LINES':
        return 'ไม่มีรายการสินค้า';
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

// ==================== 1. Validate Import ====================

export async function validateBalanceImportRows(
  rows: BalanceImportRowInput[],
): Promise<ValidateBalanceImportResult> {
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
    const data = await apiPost<SmlnesValidateResult>(
      '/api/v1/stock-adjust/validate-import-balance',
      bearer,
      { rows },
    );
    return {
      success: true,
      rows: data.rows,
      total: data.total,
      ok_count: data.ok_count,
      error_count: data.error_count,
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

// ==================== 2. Save Stock Balance ====================

export async function saveStockBalance(
  payload: StockBalancePayload,
): Promise<SaveBalanceResult> {
  const bearer = await getSessionToken();
  if (!bearer) {
    return { success: false, message: 'Session หมดอายุ — กรุณา login ใหม่' };
  }

  try {
    const data = await apiPost<SmlnesSaveResult>(
      '/api/v1/stock-adjust/balance',
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
