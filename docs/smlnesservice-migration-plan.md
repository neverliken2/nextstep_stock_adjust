# Migration Plan: Add `stock-adjust` Module to smlnesservice

> **Audience**: Agent ใน session ของ `smlnesservice` project
> **Goal**: เพิ่ม endpoints ให้ NextStep_Stock_Adjust ถอด `pg` ตรง → คุยผ่าน smlnesservice แทน
> **Pattern reference**: `src/modules/credit-note/` (มีอยู่แล้ว — **อ่านอย่างเดียว ห้ามแก้**)
> **Source ของ business logic เดิม**: `C:\Users\never\Documents\work\NextStep_Stock_Adjust\src\actions\stock-adjust.ts`

---

## 🔴 0. Backward Compatibility Constraint (อ่านก่อนเริ่ม)

**กฎเหล็ก**: ห้ามแก้ code ที่ CN coupon (`nextstep_cn_coupon`) production ใช้อยู่ — เพื่อกัน flow CN พังโดยอุบัติเหตุ

### ✅ ทำได้
- เพิ่ม endpoint ใหม่ใต้ `/api/v1/stock-adjust/*` (ไม่ทับของเดิม)
- เพิ่ม endpoint ใหม่ `/api/v1/erp-option` (CN ไม่ได้ใช้)
- เพิ่ม class/service ใหม่ใน `src/modules/auth/` (เช่น `StockAdjustPermissionService` ใหม่)
- เพิ่ม `clientCode` เป็น branch ใน `auth.service.ts.login()` แบบ append (เก่ายังทำงาน)
- เพิ่ม row ใน `ALLOWED_CLIENTS_JSON` (env)
- เพิ่ม module ใหม่ `src/modules/stock-adjust/`

### ❌ ห้ามทำ
- **ห้าม refactor** `CnPermissionService` ให้ generic
- **ห้ามย้าย** `doc-no.service.ts` จาก `modules/credit-note/` → ใช้วิธี duplicate ไปไว้ใน `modules/stock-adjust/` แทน
- **ห้ามแก้ shape** ของ `/auth/login`, `/auth/select-database` response
- **ห้ามแก้ AuthService logic** ส่วนที่ CN ใช้ (เพิ่ม branch ใหม่ขนานกันได้ แต่ห้ามเปลี่ยน flow เดิม)
- **ห้ามแตะ** ไฟล์ใน `modules/credit-note/` แม้แต่นิดเดียว

### 🟡 ยกเว้น (refactor ของเดิมได้)
- ถ้าจะแก้ของเดิม ต้อง **พิสูจน์ก่อน** ด้วย e2e test ว่า CN flow ยังทำงานครบ — ไม่มี test = ห้ามแตะ

---

## 1. Context

NextStep_Stock_Adjust เป็น web app สร้างเอกสาร **ปรับปรุงสต็อก (IA)** เดิมต่อ PG ตรงผ่าน `pg`
ตอนนี้ต้องเปลี่ยนให้คุยผ่าน smlnesservice เหมือน NextStep_CN_Coupon

**Constraint:**
- IA เป็น **value-only adjust** — qty/price = 0 ใน detail, sum_amount = ค่ามูลค่าที่ปรับ
- trans_flag = `66`, trans_type = `3`, inquiry_type = `0`, doc_format_code = `'IA'`
- `creator_code` = `last_editor_code` = `'nextstep_stock_adjust'` (audit marker)

**สูตรมูลค่า (สำคัญมาก):**
```
sum_amount = (target_avg_cost − old_cost) × qty_in_standard_unit
```
- `target_avg_cost` = ทุนเฉลี่ยที่ user ต้องการ (ค่าที่ user กรอก)
- `old_cost` = `average_cost_end` ปัจจุบันของ item ใน wh นั้น (mirror SMLERP `_stkStockInfoAndBalanceQuery` ปกติ mode)
- `qty_in_standard_unit` = `stock_qty / unit_ratio`
- เหตุผล: avg ใหม่ = `(old × qty + sum_amount) / qty = target` ← value-only ไม่เปลี่ยน qty

---

## 2. Module Structure

สร้างใหม่ที่ `src/modules/stock-adjust/`:

```
src/modules/stock-adjust/
├── stock-adjust.module.ts
├── stock-adjust.controller.ts
├── stock-adjust.service.ts
├── stock-adjust.repository.ts
├── doc-no.service.ts                  ← (อาจ extract ของ credit-note ขึ้น core ก่อน — ดูข้อ 8)
├── stock-adjust.constants.ts          ← trans_flag=66, format_code='IA', ฯลฯ
└── dto/
    ├── search-items.dto.ts
    ├── get-item-defaults.dto.ts
    ├── search-warehouses.dto.ts
    ├── search-shelves.dto.ts
    ├── get-purchase-history.dto.ts
    ├── validate-import.dto.ts
    └── save-stock-adjust.dto.ts
```

**Constants ที่ใช้:**
```ts
export const IA_TRANS_FLAG = 66;
export const IA_FORMAT_CODE = 'IA';
export const IA_TRANS_TYPE = 3;          // Inventory
export const IA_INQUIRY_TYPE = 0;        // 1.ปรับปรุงสินค้า
export const APP_CREATOR_CODE = 'nextstep_stock_adjust';
export const PURCHASE_TRANS_FLAG = 12;   // ใช้ใน getPurchaseHistory
```

---

## 3. Endpoints Spec

ทุก endpoint ต้องผ่าน `Global JwtAuthGuard` (session JWT) — เหมือน credit-note ปัจจุบัน
Response ทุกตัวห่อ envelope มาตรฐาน `{success, data, error, requestId, timestamp}` อยู่แล้วผ่าน global interceptor

> หมายเหตุ: endpoint `/api/v1/erp-option` **ตั้งใจให้เป็น core/reusable** ไม่ใช่ stock-adjust-specific (ดู §4)

### 3.1 `GET /api/v1/stock-adjust/items`

ค้นหา ic_inventory + pagination (lazy load)

**Query params:**
| param | type | default | note |
|---|---|---|---|
| `query` | string | `''` | ค้นหา code/name_1 (ว่าง = list ทั้งหมด) |
| `offset` | number | `0` | |
| `limit` | number | `30` | clamp 1..100 |

**Response data:**
```ts
{
  rows: Array<{
    code: string;
    name: string;
    unit_standard: string;
    average_cost: number;
  }>;
  has_more: boolean;
}
```

**SQL** (query limit+1 รู้ has_more):
```sql
SELECT code, name_1, unit_standard, average_cost
FROM ic_inventory
WHERE ($1 = '' OR code ILIKE $1 || '%' OR name_1 ILIKE '%' || $1 || '%')
ORDER BY code
LIMIT $2 OFFSET $3
```

---

### 3.2 `GET /api/v1/stock-adjust/items/:itemCode`

ดึง item info + units + stock + cost (จาก wh ที่ระบุ)

**Path params:** `:itemCode` (string)
**Query params:** `whCode` (string, optional)

**Response data:**
```ts
{
  item: {
    code: string;
    name: string;
    unit_standard: string;
    average_cost: number;        // ทุนเฉลี่ยปัจจุบัน (override ด้วย avgCostEnd จาก trans ล่าสุด)
  } | null;
  units: Array<{
    code: string;
    stand_value: number;
    divide_value: number;
    ratio: number;               // = stand_value / divide_value
  }>;
  stock_qty: number;             // คงเหลือในหน่วย unit_standard (จาก trans calc)
}
```

**SQL:**
1. **Item info** — query `ic_inventory WHERE code = $1`
2. **Units** — query `ic_inventory_unit WHERE ic_code = $1`
3. **Stock + cost** — ใช้ `getStockAndCost(itemCode, whCode, asOfDate=today)` (ดู §6.1)
   - ถ้า rows มี → override `item.average_cost = avgCostEnd`

---

### 3.3 `GET /api/v1/stock-adjust/warehouses`

ค้นหาคลัง

**Query params:** `query` (string, default `''`)

**Response data:**
```ts
Array<{ code: string; name: string }>
```

**SQL:**
```sql
SELECT code, name_1
FROM ic_warehouse
WHERE code ILIKE $1 OR name_1 ILIKE $1
ORDER BY code
LIMIT 100
```

---

### 3.4 `GET /api/v1/stock-adjust/shelves`

ค้นหา shelf (filter ตาม wh ถ้าระบุ)

**Query params:** `query`, `whCode` (optional)

**Response data:**
```ts
Array<{ code: string; name: string; wh_code: string }>
```

**SQL:**
```sql
SELECT code, name_1, whcode
FROM ic_shelf
WHERE (code ILIKE $1 OR name_1 ILIKE $1)
  AND ($2 = '' OR whcode = $2)
ORDER BY code
LIMIT 100
```

---

### 3.5 `GET /api/v1/stock-adjust/purchase-history/:itemCode`

ประวัติการซื้อ (trans_flag=12, last_status=0)

**Path:** `:itemCode`
**Query:** `offset`, `limit` (default 0, 10; clamp 1..100)

**Response data:**
```ts
{
  rows: Array<{
    doc_no: string;
    doc_date: string;            // ⚠️ ISO 'YYYY-MM-DD' (ต้องใช้ TO_CHAR กัน timezone bug)
    vendor_code: string;
    vendor_name: string;
    qty: number;
    price: number;
    unit_code: string;
    vat_type: number;            // 1=รวมใน, 2=แยกนอก, อื่น=ไม่มี
  }>;
  has_more: boolean;
}
```

**SQL** (⚠️ TO_CHAR สำคัญ ไม่งั้น date จะแสดงผิด):
```sql
SELECT t.doc_no,
       TO_CHAR(t.doc_date, 'YYYY-MM-DD') AS doc_date,
       t.cust_code,
       s.name_1 AS vendor_name,
       d.qty, d.price, d.unit_code, d.vat_type
FROM ic_trans t
JOIN ic_trans_detail d ON d.trans_flag = t.trans_flag AND d.doc_no = t.doc_no
LEFT JOIN ap_supplier s ON s.code = t.cust_code
WHERE t.trans_flag = 12
  AND t.last_status = 0
  AND d.item_code = $1
ORDER BY t.doc_date DESC, t.doc_no DESC
LIMIT $2 OFFSET $3
```

---

### 3.6 `POST /api/v1/stock-adjust/validate-import`

Validate Excel import rows (item exists, has units, stock+cost lookup)

**Request body:**
```ts
{
  rows: Array<{
    row_index: number;
    item_code: string;
    unit_code: string;
    new_cost: number;            // จริงๆ คือ target_avg_cost — เก็บชื่อ field เดิมเพื่อ backward compat
  }>;
  wh_code: string;               // คลังที่จะใช้ query stock+cost
}
```

**Response data:**
```ts
Array<{
  row_index: number;
  item_code: string;
  item_name: string;
  unit_code: string;
  unit_standard?: string;
  units?: Array<{ code, stand_value, divide_value, ratio }>;
  stand_value?: number;
  divide_value?: number;
  stock_qty?: number;
  old_cost?: number;             // = avgCostEnd
  new_cost: number;
  valid: boolean;
  error?: string;                // ถ้า valid=false จะมี message
}>
```

**Validation rules** (ตามลำดับ):
1. `item_code` ว่าง → error `'ไม่ได้ระบุรหัสสินค้า'`
2. `unit_code` ว่าง → error `'ไม่ได้ระบุหน่วยนับ'`
3. `new_cost` ไม่ใช่ number → error `'ทุนเฉลี่ยที่ต้องการผิด format'`
4. `new_cost < 0` → error `'ทุนติดลบ'`
5. query item → ไม่เจอ → error `'ไม่พบรหัสสินค้านี้'`
6. query units → ไม่มีหน่วย → error `'ไม่มีข้อมูลหน่วยนับ'`
7. unit_code ไม่อยู่ใน units → error `'หน่วยนับไม่ตรง'`
8. ทุก row ผ่าน → query stock+cost (concurrent แต่ limit pool, recommend p-limit หรือ Promise.all เป็น batch 10)
9. ถ้า stock_qty = 0 → set warning ไม่ block

---

### 3.7 `POST /api/v1/stock-adjust`

สร้างเอกสาร IA (INSERT ic_trans + ic_trans_detail ใน transaction)

**Request body:**
```ts
{
  doc_date: string;              // 'YYYY-MM-DD'
  doc_time: string;              // 'HH:mm'
  doc_ref?: string;
  doc_ref_date?: string;
  wh_from: string;
  location_from: string;
  remark?: string;
  lines: Array<{
    item_code: string;
    item_name: string;
    unit_code: string;
    sum_amount: number;          // มูลค่าที่จะ insert (client คำนวณแล้ว = (target - old) × qty)
    wh_code?: string;            // ถ้าไม่ส่ง ใช้ wh_from
    shelf_code?: string;
    stand_value: number;
    divide_value: number;
  }>;
}
```

**Response data:**
```ts
{
  doc_no: string;                // เลขที่ที่ gen ขึ้นมา เช่น 'IA26060003'
  total_amount: number;
}
```

**Save flow (transaction):**

```
1. lock + generate doc_no
   - read erp_doc_format WHERE code='IA' (format pattern เช่น '@YYMM####')
   - parse pattern: @ = code, YY/YYYY = ปี, MM/DD, # = digit padding
   - find MAX running ใน ic_trans WHERE trans_flag=66 AND doc_format_code='IA' AND doc_no matches pattern
   - +1 → new doc_no
   - (อาจ reuse doc-no.service ของ credit-note module — ดู §8)

2. check duplicate
   SELECT doc_no FROM ic_trans WHERE trans_flag=66 AND doc_no=$1
   → ถ้ามี throw ConflictException

3. round sum_amount แต่ละ line ที่ 5 ตำแหน่ง
   round5(sum_amount) ใน core/util (ทำ helper)
   total_amount = round2(sum ของทุก line)

4. INSERT ic_trans (header)
   - status, last_status, used_status, used_status_2, doc_success = 0
   - branch_code = '0000'
   - creator_code = last_editor_code = 'nextstep_stock_adjust'
   - inquiry_type = 0 (1.ปรับปรุงสินค้า)

5. INSERT ic_trans_detail (each line) — IMPORTANT pattern
   - qty = 0, price = 0 (value-only)
   - sum_amount = sum_of_cost = sum_amount_exclude_vat = sum_of_cost_1 = ${rounded amount}
   - average_cost = average_cost_1 = 0 (price = 0)
   - ratio = 0 (smlerp ตั้งใจ set 0)
   - is_get_price = 1
   - ref_row = -1
   - price_type, price_mode = NULL
   - calc_flag = 1
   - branch_code = '0000'
   - inquiry_type = 0
```

> ดู SQL เต็มใน source code: `NextStep_Stock_Adjust/src/actions/stock-adjust.ts` function `saveStockAdjust` (ก่อน migration)

**Error mapping:**
| Condition | HTTP | Code |
|---|---|---|
| ไม่เจอ erp_doc_format 'IA' | 404 | `DOC_FORMAT_NOT_FOUND` |
| doc_no ซ้ำ (race condition) | 409 | `DUPLICATE_DOC_NO` |
| lines ว่าง | 400 | `EMPTY_LINES` |
| sum_amount = 0 ทุก line | 400 | `ZERO_AMOUNT` |
| pg sequence ตัน | 500 | (catch + setval retry — ดู cn_coupon gotcha #1) |

---

## 4. Core endpoints (promote ขึ้น core เพราะ reusable ข้าม module)

### 4.1 `GET /api/v1/erp-option`

ดึง erp_option row เดียว (sml ใช้ row เดียว)

**Response data:**
```ts
{
  vat_rate: number;              // % เช่น 7 (fallback 7 ถ้า NULL)
  item_amount_decimal: number;   // จำนวนทศนิยมสำหรับ amount/cost (fallback 2)
  // เผื่ออนาคต — แต่ตอนนี้ stock-adjust ใช้แค่ 2 ตัวบน
  item_qty_decimal?: number;
  item_price_decimal?: number;
}
```

**SQL:**
```sql
SELECT vat_rate, item_amount_decimal, item_qty_decimal, item_price_decimal
FROM erp_option
LIMIT 1
```

**ที่อยู่:** `src/modules/erp-option/` (new module) หรือ extract เป็น helper ใน `src/core/erp-option/`

---

## 5. DTO Schemas (Zod)

ใช้ pattern เดียวกับ credit-note module — ไม่ใช้ class-validator

```ts
// search-items.dto.ts
import { z } from 'zod';

export const SearchItemsQuerySchema = z.object({
  query: z.string().default(''),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type SearchItemsQuery = z.infer<typeof SearchItemsQuerySchema>;

export interface SearchItemsResponse {
  rows: ItemOption[];
  has_more: boolean;
}
```

(ส่วน DTO อื่นๆ ใช้ pattern เดียวกัน)

---

## 6. Internal Helpers (shared)

### 6.1 `getStockAndCost(database, itemCode, whCode, asOfDate?)`

Mirror SMLERP `_stkStockInfoAndBalanceQuery` (costMode = ปกติ):
- **stockQty** = SUM ของ qty (trans_flag=66 บวก/ลบตามทิศ + ปกติบวก) ของ item+wh, calc ก่อน asOfDate (default today)
- **avgCostEnd** = `average_cost` จาก trans active ล่าสุด × `stand_value / divide_value` ของ unit_standard

```sql
-- ใช้ SQL เดียวที่ NextStep_Stock_Adjust/src/actions/stock-adjust.ts function getStockAndCost ใช้อยู่
-- มี window function + CTE — copy ทั้ง block มาได้เลย
```

> ⚠️ Migration: copy SQL ทั้ง block จาก source — ห้ามเขียนใหม่เพราะ logic นี้ mirror SMLERP precisely

### 6.2 `round5(n)`, `round2(n)` — ใส่ใน `core/util/numeric.util.ts`

```ts
export function round5(n: number): number {
  return Math.round(n * 100000) / 100000;
}
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
```

---

## 7. Auth Integration (no breaking change)

**ทุก endpoint ใช้ TenantContext จาก global JwtAuthGuard (เหมือน CN):**
```ts
@Get('items')
async searchItems(
  @Tenant() ctx: TenantContext,
  @Query() query: SearchItemsQuery,
) {
  return this.svc.searchItems(ctx.database, query);
}
```

`ctx.database` = ชื่อ data DB (เช่น `'demo'`) — ใส่ลง `PoolManagerService.query(database, sql, params)`

**Client token** เพิ่ม row ใหม่ใน `ALLOWED_CLIENTS_JSON` (ของ CN ยังอยู่ครบ):
```json
[
  {"clientCode":"nextstep_cn_coupon","tokenHash":"$2b$12$..."},          // เดิม — ห้ามแตะ
  {"clientCode":"nextstep_stock_adjust","tokenHash":"$2b$12$..."}        // ← เพิ่ม
]
```

### 7.1 Permission Check (per-client)

**กฎ:** CN และ Stock Adjust ใช้ menu code คนละตัว → ต้องเลือก permission service ตาม `clientCode`

**ทำแบบไหน (เพื่อไม่กระทบ CN):**

1. สร้าง **ไฟล์ใหม่** `src/modules/auth/stock-adjust-permission.service.ts` (mirror logic จาก `cn-permission.service.ts` — copy แล้วเปลี่ยน menu code)
   ```ts
   const GATE_MENU_CODE = 'menu_ic_stk_adjust';

   @Injectable()
   export class StockAdjustPermissionService {
     async checkStockAdjustAccess(provider: string, usercode: string): Promise<PermissionResult> {
       // logic เดียวกับ CnPermissionService — ใช้ blob/group flag
       // เปลี่ยนแค่ GATE_MENU_CODE
     }
   }
   ```

2. ใน `auth.service.ts.login()` **เพิ่ม branch ใหม่** (ของ CN ยังทำงานเหมือนเดิม):
   ```ts
   // เดิม (CN) — ไม่แตะ
   if (clientCode === 'nextstep_cn_coupon') {
     const perm = await this.cnPermission.checkCreditNoteAccess(provider, user.user_code);
     if (!perm.allowed) throw new ForbiddenException({code: ErrorCode.NO_PERMISSION, ...});
   }
   // ใหม่ — append
   else if (clientCode === 'nextstep_stock_adjust') {
     const perm = await this.stockAdjustPermission.checkStockAdjustAccess(provider, user.user_code);
     if (!perm.allowed) throw new ForbiddenException({code: ErrorCode.NO_PERMISSION, ...});
   }
   ```

3. ลงทะเบียน `StockAdjustPermissionService` ใน `AuthFeatureModule.providers`

> **ห้าม** refactor `CnPermissionService` ให้ generic — duplicate code ยอมรับได้ในรอบนี้ (กัน CN พัง)

---

## 8. doc-no.service — Duplicate (no shared core)

**ตัดสินใจ:** Copy ไฟล์มาไว้ใน module ใหม่ (ไม่ promote ขึ้น core — กัน CN ได้รับผลกระทบ)

- คัดลอก `src/modules/credit-note/doc-no.service.ts` → `src/modules/stock-adjust/doc-no.service.ts`
- ใช้ scope ภายใน stock-adjust module เท่านั้น
- API เหมือนกัน: `getNextDocNo(database, formatCode, docDate, transFlag)`

**Tech debt ยอมรับ:** 2 ไฟล์เหมือนกัน — ถ้าจะ refactor ขึ้น core ในอนาคต ต้องทำเป็น dedicated PR + e2e test ของ CN ผ่านก่อน (อยู่นอก scope migration นี้)

---

## 9. Error Codes (เพิ่มใน `core/error/error-codes.ts`)

```ts
// IA-specific
DOC_FORMAT_NOT_FOUND = 'DOC_FORMAT_NOT_FOUND',
DUPLICATE_DOC_NO     = 'DUPLICATE_DOC_NO',    // มีอยู่แล้วใน credit-note ก็ reuse
EMPTY_LINES          = 'EMPTY_LINES',
ZERO_AMOUNT          = 'ZERO_AMOUNT',
ITEM_NOT_FOUND       = 'ITEM_NOT_FOUND',
UNIT_NOT_FOUND       = 'UNIT_NOT_FOUND',
INVALID_COST         = 'INVALID_COST',
```

---

## 10. Testing Checklist

- [ ] Unit test `getStockAndCost` กับ items ที่มี trans หลายรอบ
- [ ] Integration test save flow — IA ขึ้น 1 doc แล้ว balance update ถูก
- [ ] Negative test — duplicate doc_no, format ไม่เจอ, line ว่าง
- [ ] Concurrency test — 2 requests gen doc_no พร้อมกัน → ห้ามได้เลขซ้ำ (lock ดี?)
- [ ] Date timezone — ตรวจว่า doc_date ของ purchase-history ออกเป็น YYYY-MM-DD ทุกครั้ง
- [ ] Validate import — Excel 1000 rows ไม่ timeout (concurrent ดี?)

---

## 11. Gotchas (เคยพลาดในฝั่ง NextStep_Stock_Adjust)

1. **TO_CHAR(date) สำคัญมาก** — ถ้าไม่ใช้ pg ส่งกลับเป็น Date object → `String(...).slice(0,10)` พังเป็น `"Tue May 12"` ทำให้ format DD/MM/YYYY ไม่ถูก
2. **IA insert qty=0, price=0** — ไม่ใช่ qty=stock_qty หรือ qty=qty_line — sml อ่าน sum_amount ตรงๆ
3. **ratio = 0 ใน detail** — แม้ stand_value/divide_value จะมีค่า (smlerp ตั้งใจ)
4. **stock_qty ที่ใช้คำนวณ sum_amount** — เป็น qty ในหน่วย unit ที่ user เลือก (`stock_qty_std / ratio`) ไม่ใช่ stock_qty ของ unit_standard
5. **avgCostEnd จาก SMLERP** — query `average_cost × stand_value/divide_value` ของ unit_standard เพราะ avg ถูกเก็บไว้ใน unit นั้นๆ
6. **vat_type values** — `1`=รวมใน, `2`=แยกนอก, อื่น=ไม่มี (frontend cn_coupon ก็ใช้ pattern เดียวกัน)

---

## 12. Roadmap Sequence (recommend — เรียงตามกฎ §0)

> ทุก PR ทำใน branch `feat/stock-adjust-module` ไม่ merge เข้า main จนกว่าจะ test integration กับฝั่ง Next.js ผ่าน

1. **PR 1:** Add `StockAdjustPermissionService` (new file) + register ใน AuthFeatureModule + add `clientCode='nextstep_stock_adjust'` branch ใน `auth.service.login()` (append เท่านั้น)
2. **PR 2:** Add `nextstep_stock_adjust` row ใน `ALLOWED_CLIENTS_JSON` (env)
3. **PR 3:** Add core `/api/v1/erp-option` endpoint (เล็ก ทดสอบ infra ก่อน)
4. **PR 4:** Create `src/modules/stock-adjust/` skeleton (module, controller, service, repository, dto, constants) + duplicate `doc-no.service.ts`
5. **PR 5:** stock-adjust read endpoints (items search, items detail, warehouses, shelves, purchase-history)
6. **PR 6:** stock-adjust validate-import endpoint
7. **PR 7:** stock-adjust save endpoint (POST — transaction)
8. **PR 8:** Update Swagger docs
9. **PR 9:** e2e tests — verify CN flow ยังทำงาน + stock-adjust flow ใหม่ทำงานครบ
10. **PR 10:** Bump version + production deploy

---

## 13. Reference Files

| File | บทบาท |
|---|---|
| `NextStep_Stock_Adjust/src/actions/stock-adjust.ts` | source ของ business logic ทั้งหมด — copy SQL มาใช้ตรงๆ ได้ |
| `NextStep_Stock_Adjust/src/components/stock-adjust/PurchaseHistoryModal.tsx` | reference UI ที่จะใช้ endpoint นี้ |
| `smlnesservice/src/modules/credit-note/credit-note.service.ts` | pattern อ้างอิงสำหรับ stock-adjust.service |
| `smlnesservice/src/modules/credit-note/credit-note.repository.ts` | pattern อ้างอิงสำหรับ stock-adjust.repository |
| `smlerp22_new/SMLERPTemplate/smldatabase.xml` | source of truth ของ schema |

---

## 14. After smlnesservice ขึ้นเสร็จ

ฝั่ง NextStep_Stock_Adjust จะ:
1. Add `SMLNES_BASE_URL` + `SMLNES_CLIENT_TOKEN` ใน `.env`
2. Replace `actions/auth.ts`, `actions/stock-adjust.ts` → call API ผ่าน `api-client.ts`
3. ลบ `lib/db.ts`, `lib/database.ts` + ลบ `pg` จาก `package.json`
4. Bump version → `1.3.0`
5. Rebuild docker + redeploy

ระหว่าง migration **ใช้ feature branch ทั้งคู่** กัน prod broken
