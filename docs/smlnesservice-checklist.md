# Checklist: smlnesservice TODO สำหรับ stock-adjust module

> **เป้าหมาย**: ให้ session ของ smlnesservice เช็คทีละข้อ ว่าอันไหนทำแล้ว/ยัง
> **อ้างอิงเต็ม**: [`smlnesservice-migration-plan.md`](./smlnesservice-migration-plan.md) — section อ้างอิงระบุไว้แต่ละข้อ
> **กฎเหล็ก**: ห้ามแก้ code ที่ CN coupon ใช้อยู่ (ดู §0 ในแผนเต็ม)

---

## 🔧 Part 1 — Auth / Permission (PR-1 + PR-2)

### [ ] 1.1 สร้าง `StockAdjustPermissionService`

**Where:** `src/modules/auth/stock-adjust-permission.service.ts` (ไฟล์ใหม่)
**Action:**
- Copy `cn-permission.service.ts` มาเป็นต้นแบบ
- เปลี่ยน:
  - class name → `StockAdjustPermissionService`
  - method name → `checkStockAdjustAccess(provider, usercode)`
  - `GATE_MENU_CODE` → `'menu_ic_stk_adjust'`
  - Logger name + log message

**DONE if:**
- ไฟล์มีอยู่
- export `class StockAdjustPermissionService`
- มี method `async checkStockAdjustAccess(provider: string, usercode: string): Promise<...>`
- gate menu = `menu_ic_stk_adjust`
- **`CnPermissionService` ยังอยู่เหมือนเดิม ไม่ถูกแตะ**

---

### [ ] 1.2 Register ใน `AuthFeatureModule`

**Where:** `src/modules/auth/auth.module.ts`
**Action:**
- เพิ่ม `StockAdjustPermissionService` ใน `providers: [...]`
- `CnPermissionService` ยังต้องอยู่ไม่ถูกแตะ

**DONE if:**
- `providers` array มีทั้ง `CnPermissionService` และ `StockAdjustPermissionService`

---

### [ ] 1.3 แก้ `auth.service.login()` — clientCode branching

**Where:** `src/modules/auth/auth.service.ts`
**Action:**
- inject `StockAdjustPermissionService` ใน constructor (เพิ่มข้างหลัง `cnPermission`)
- แก้ block permission check จาก hardcoded เป็น **if/else if** ตาม `clientCode`:

```ts
// เดิม
const perm = await this.cnPermission.checkCreditNoteAccess(provider, user.user_code);
if (!perm.allowed) throw new ForbiddenException({...});

// ใหม่
let permAllowed = true;
if (clientCode === 'nextstep_cn_coupon') {
  const perm = await this.cnPermission.checkCreditNoteAccess(provider, user.user_code);
  permAllowed = perm.allowed;
} else if (clientCode === 'nextstep_stock_adjust') {
  const perm = await this.stockAdjustPermission.checkStockAdjustAccess(provider, user.user_code);
  permAllowed = perm.allowed;
}
// else: client อื่นๆ ผ่าน (จะมี client ใหม่อนาคต) — หรือ throw 403 ตาม policy

if (!permAllowed) {
  throw new ForbiddenException({
    code: ErrorCode.NO_PERMISSION,
    message: 'ไม่มีสิทธิ์เข้าใช้งานระบบ',
  });
}
```

**DONE if:**
- CN flow เดิม (clientCode = `nextstep_cn_coupon`) ยังทำงานเหมือนเดิมเป๊ะ
- Stock adjust client (clientCode = `nextstep_stock_adjust`) เรียก `checkStockAdjustAccess` แทน
- e2e test ของ CN ผ่าน (ถ้ามี)

---

### [ ] 1.4 เพิ่ม `nextstep_stock_adjust` token ใน `ALLOWED_CLIENTS_JSON`

**Where:** env (production) + `.env.example` (template)
**Action:**
- Gen raw token + bcrypt hash:
  ```js
  const bcrypt = require('bcrypt');
  const raw = require('crypto').randomBytes(32).toString('hex');
  console.log('RAW:', raw);                     // → ฝั่ง NextStep_Stock_Adjust .env
  console.log('HASH:', bcrypt.hashSync(raw, 12)); // → ALLOWED_CLIENTS_JSON
  ```
- เพิ่ม row ใหม่ในตัวอย่าง `.env.example`:
  ```json
  ALLOWED_CLIENTS_JSON=[
    {"clientCode":"nextstep_cn_coupon","tokenHash":"$2b$12$..."},
    {"clientCode":"nextstep_stock_adjust","tokenHash":"$2b$12$..."}
  ]
  ```

**DONE if:**
- `.env.example` มี 2 entries (CN + stock adjust)
- raw token ของ stock adjust พร้อมส่งให้ฝั่ง NextStep_Stock_Adjust ใส่ `SMLNES_CLIENT_TOKEN`

---

## 📦 Part 2 — Core endpoint `/api/v1/erp-option` (PR-3)

### [ ] 2.1 สร้าง endpoint `GET /api/v1/erp-option`

**Where:** ออกแบบได้ 2 ทาง — เลือกอันใดอันหนึ่ง:
- A) สร้าง `src/modules/erp-option/` module ใหม่ (controller + service + repo)
- B) เพิ่มเข้า core เช่น `src/core/erp-option/` (`@Global()`)

**Schema:** อ่านจาก `erp_option` row เดียว
**SQL:**
```sql
SELECT vat_rate, item_amount_decimal, item_qty_decimal, item_price_decimal
FROM erp_option
LIMIT 1
```

**Response:**
```json
{
  "vat_rate": 7,
  "item_amount_decimal": 2,
  "item_qty_decimal": 3,
  "item_price_decimal": 5
}
```

**Fallback:** ถ้า NULL/ไม่มีแถว → `{vat_rate: 7, item_amount_decimal: 2}`

**Auth:** ผ่าน global JwtAuthGuard (session JWT)

**DONE if:**
- เรียก `curl -H "Authorization: Bearer <sessionJWT>" http://localhost:3000/api/v1/erp-option` แล้วได้ envelope `{success:true, data:{vat_rate, item_amount_decimal}, ...}`
- Swagger doc มี endpoint นี้

---

## 🏗 Part 3 — Stock Adjust Module Skeleton (PR-4)

### [ ] 3.1 สร้าง folder + ไฟล์ skeleton

**Where:** `src/modules/stock-adjust/`
**Files:**
- [ ] `stock-adjust.module.ts`
- [ ] `stock-adjust.controller.ts`
- [ ] `stock-adjust.service.ts`
- [ ] `stock-adjust.repository.ts`
- [ ] `doc-no.service.ts` (copy จาก `modules/credit-note/doc-no.service.ts`)
- [ ] `stock-adjust.constants.ts`
- [ ] `dto/` folder

**`stock-adjust.constants.ts`:**
```ts
export const IA_TRANS_FLAG = 66;
export const IA_FORMAT_CODE = 'IA';
export const IA_TRANS_TYPE = 3;
export const IA_INQUIRY_TYPE = 0;
export const APP_CREATOR_CODE = 'nextstep_stock_adjust';
export const PURCHASE_TRANS_FLAG = 12;  // สำหรับ getPurchaseHistory
```

### [ ] 3.2 Register module ใน `app.module.ts`

**DONE if:**
- `imports: [..., StockAdjustModule]`

---

## 📡 Part 4 — Read Endpoints (PR-5)

ทุก endpoint:
- prefix `/api/v1/stock-adjust`
- ผ่าน global JwtAuthGuard (session JWT)
- ใช้ `@Tenant() ctx: TenantContext` → `ctx.database`
- Response envelope มาตรฐาน (global ResponseInterceptor)

### [ ] 4.1 `GET /stock-adjust/items` — search items + pagination

**Query:** `query` (default `''`), `offset` (default `0`), `limit` (default `30`, clamp 1..100)

**SQL:**
```sql
SELECT code, name_1, unit_standard, average_cost
FROM ic_inventory
WHERE ($1 = '' OR code ILIKE $1 || '%' OR name_1 ILIKE '%' || $1 || '%')
ORDER BY code
LIMIT $2 OFFSET $3
```

**Response:**
```json
{ "rows": [{"code","name","unit_standard","average_cost"}], "has_more": boolean }
```

> ใช้ trick query limit+1 → ดู rows length > limit → `has_more = true`

**DONE if:**
- query ว่าง → ได้ items ทั้ง 52,577 แบบ paginate
- query='02-' → filter ด้วย code ILIKE
- pagination ทำงานถูก

---

### [ ] 4.2 `GET /stock-adjust/items/:itemCode` — item defaults

**Path:** `:itemCode`
**Query:** `whCode` (optional)

**Logic:**
1. ดึง item info จาก `ic_inventory WHERE code = $1`
2. ดึง units จาก `ic_inventory_unit WHERE ic_code = $1`
3. ถ้า `whCode` → call internal `getStockAndCost(database, itemCode, whCode, asOfDate=today)` (mirror SMLERP `_stkStockInfoAndBalanceQuery`)
4. ถ้ามี stock data → override `item.average_cost = avgCostEnd`

**Response:**
```json
{
  "item": {"code","name","unit_standard","average_cost"} | null,
  "units": [{"code","stand_value","divide_value","ratio"}],
  "stock_qty": number
}
```

**DONE if:**
- ตัวอย่าง: itemCode = `'02-0006'`, whCode = `'MMA01'` → ได้ stock + cost ตรงกับใน SMLERP
- ดู SQL ของ `getStockAndCost` ใน source: [`NextStep_Stock_Adjust/src/actions/stock-adjust.ts` — function getStockAndCost (เวอร์ชัน main branch)](https://github.com/neverliken2/nextstep_stock_adjust/blob/main/src/actions/stock-adjust.ts)

---

### [ ] 4.3 `GET /stock-adjust/warehouses` — search warehouses

**Query:** `query` (default `''`)

**SQL:**
```sql
SELECT code, name_1
FROM ic_warehouse
WHERE code ILIKE $1 OR name_1 ILIKE $1
ORDER BY code
LIMIT 100
```

**Response:**
```json
[{"code","name"}]
```

---

### [ ] 4.4 `GET /stock-adjust/shelves` — search shelves (filter by wh)

**Query:** `query`, `whCode` (optional)

**SQL:**
```sql
SELECT code, name_1, whcode
FROM ic_shelf
WHERE (code ILIKE $1 OR name_1 ILIKE $1)
  AND ($2 = '' OR whcode = $2)
ORDER BY code
LIMIT 100
```

**Response:**
```json
[{"code","name","wh_code"}]
```

---

### [ ] 4.5 `GET /stock-adjust/purchase-history/:itemCode` — purchase history

**Path:** `:itemCode`
**Query:** `offset` (default `0`), `limit` (default `10`, clamp 1..100)

**SQL** (⚠️ `TO_CHAR` สำคัญ กัน timezone bug — ดู §11.1 ในแผน):
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

**Response:**
```json
{
  "rows": [{
    "doc_no", "doc_date",     // ⚠️ doc_date เป็น string ISO 'YYYY-MM-DD' จาก TO_CHAR
    "vendor_code", "vendor_name",
    "qty", "price", "unit_code", "vat_type"
  }],
  "has_more": boolean
}
```

**DONE if:**
- date ออกเป็น `2026-05-12` (string) ไม่ใช่ Date object
- ทดสอบ `itemCode='12-0869'` ได้ ~181 records ใน demo DB

---

## ✍️ Part 5 — Write Endpoints (PR-6 + PR-7)

### [ ] 5.1 `POST /stock-adjust/validate-import` — Excel validation

**Body:**
```json
{
  "rows": [{"row_index", "item_code", "unit_code", "new_cost"}],
  "wh_code": "MMA01"
}
```

**Logic (validate ต่อ row):**
1. item_code ว่าง → `error: 'ไม่ได้ระบุรหัสสินค้า'`
2. unit_code ว่าง → `error: 'ไม่ได้ระบุหน่วยนับ'`
3. new_cost ไม่ใช่ number → `error: 'ทุนเฉลี่ยที่ต้องการผิด format'`
4. new_cost < 0 → `error: 'ทุนติดลบ'`
5. query item — ไม่เจอ → `error: 'ไม่พบรหัสสินค้านี้'`
6. query units — ไม่มี → `error: 'ไม่มีข้อมูลหน่วยนับ'`
7. unit_code ไม่อยู่ใน units → `error: 'หน่วยนับไม่ตรง'`
8. ผ่าน → query stock + cost (batch concurrent ~10 limit)

**Response:**
```json
[{
  "row_index", "item_code", "unit_code", "new_cost",
  "valid": boolean, "error": string | undefined,
  // ถ้า valid:
  "item_name", "unit_standard", "units", "stand_value", "divide_value",
  "stock_qty", "old_cost"
}]
```

---

### [ ] 5.2 `POST /stock-adjust` — save IA document (transaction)

**Body:**
```json
{
  "doc_date": "YYYY-MM-DD",
  "doc_time": "HH:mm",
  "doc_ref": "string | optional",
  "doc_ref_date": "string | optional",
  "wh_from": "string",
  "location_from": "string",
  "remark": "string | optional",
  "lines": [{
    "item_code", "item_name", "unit_code",
    "sum_amount",      // มูลค่าที่จะ insert
    "wh_code", "shelf_code",
    "stand_value", "divide_value"
  }]
}
```

**Transaction flow:**
1. lock + gen doc_no — read `erp_doc_format WHERE code='IA'` → parse pattern → find MAX → +1
2. check duplicate `doc_no` ใน `ic_trans WHERE trans_flag=66 AND doc_no=$1`
3. round sum_amount แต่ละ line ที่ 5 ตำแหน่ง
4. total_amount = round2(sum of rounded lines)
5. INSERT `ic_trans` (header) — status, last_status, used_status, used_status_2, doc_success = 0, branch_code='0000', creator_code=last_editor_code='nextstep_stock_adjust', inquiry_type=0
6. INSERT `ic_trans_detail` (each line) — ⚠️ qty=0, price=0 (value-only)
   - sum_amount = sum_of_cost = sum_amount_exclude_vat = sum_of_cost_1 = rounded amount
   - average_cost = average_cost_1 = 0
   - ratio = 0 (smlerp ตั้งใจ set 0)
   - is_get_price = 1, ref_row = -1
   - branch_code='0000', inquiry_type=0, calc_flag=1

**Response:**
```json
{ "doc_no": "IA26060003", "total_amount": 1234.56 }
```

**Error mapping:** ดู §3.7 ในแผนเต็ม (error codes)

**DONE if:**
- save แล้วเอกสารปรากฏใน `ic_trans` ตามรูปแบบ SMLERP เป๊ะ
- duplicate doc_no → throw `DUPLICATE_DOC_NO` (HTTP 409)
- lines ว่าง → throw `EMPTY_LINES` (HTTP 400)

---

## 🚨 Part 6 — Error Codes (เพิ่มใน `core/error/error-codes.ts`)

### [ ] 6.1 เพิ่ม error codes ใหม่

```ts
DOC_FORMAT_NOT_FOUND = 'DOC_FORMAT_NOT_FOUND',
EMPTY_LINES          = 'EMPTY_LINES',
ZERO_AMOUNT          = 'ZERO_AMOUNT',
ITEM_NOT_FOUND       = 'ITEM_NOT_FOUND',
UNIT_NOT_FOUND       = 'UNIT_NOT_FOUND',
INVALID_COST         = 'INVALID_COST',
// DUPLICATE_DOC_NO มีอยู่แล้ว reuse จาก CN
```

---

## 📚 Part 7 — Swagger + Docs (PR-8)

### [ ] 7.1 Swagger annotations
- ทุก endpoint ใหม่มี `@ApiOperation`, `@ApiResponse`, `@ApiQuery`/`@ApiBody`
- รวมใน `/api/docs` (existing Swagger UI)

---

## 🧪 Part 8 — Testing (PR-9)

### [ ] 8.1 Existing CN flow ยังทำงาน (regression test)
- e2e: login → select database → list invoices → save CN
- ใช้ test data demo DB

### [ ] 8.2 Stock adjust flow ใหม่ทำงานครบ
- e2e: login (with menu_ic_stk_adjust permission) → select database → search items → save IA
- Negative: login user ที่ไม่มี permission → ได้ 403 NO_PERMISSION

### [ ] 8.3 Date timezone test
- save IA + getPurchaseHistory — doc_date ออกเป็น `YYYY-MM-DD` string ทุกครั้ง

---

## 🚀 Part 9 — Deploy (PR-10)

### [ ] 9.1 Bump version smlnesservice
### [ ] 9.2 Docker build + push Docker Hub
### [ ] 9.3 ลง production env เพิ่ม `nextstep_stock_adjust` row ใน `ALLOWED_CLIENTS_JSON`

---

## 🔍 Quick Verification Commands

หลังทำเสร็จ ทดสอบทีละ endpoint ด้วย `curl` (มี `<sessionJWT>` แล้ว):

```bash
# 1. erp-option
curl -H "Authorization: Bearer <sessionJWT>" http://localhost:3000/api/v1/erp-option

# 2. search items
curl -H "Authorization: Bearer <sessionJWT>" \
  "http://localhost:3000/api/v1/stock-adjust/items?query=02-&limit=5"

# 3. item defaults
curl -H "Authorization: Bearer <sessionJWT>" \
  "http://localhost:3000/api/v1/stock-adjust/items/02-0006?whCode=MMA01"

# 4. warehouses
curl -H "Authorization: Bearer <sessionJWT>" \
  "http://localhost:3000/api/v1/stock-adjust/warehouses"

# 5. shelves
curl -H "Authorization: Bearer <sessionJWT>" \
  "http://localhost:3000/api/v1/stock-adjust/shelves?whCode=MMA01"

# 6. purchase history
curl -H "Authorization: Bearer <sessionJWT>" \
  "http://localhost:3000/api/v1/stock-adjust/purchase-history/12-0869?limit=10"

# 7. validate import
curl -X POST -H "Authorization: Bearer <sessionJWT>" \
  -H "Content-Type: application/json" \
  -d '{"rows":[{"row_index":1,"item_code":"02-0006","unit_code":"ชิ้น","new_cost":450}],"wh_code":"MMA01"}' \
  http://localhost:3000/api/v1/stock-adjust/validate-import

# 8. save (last test — สร้าง doc จริง)
curl -X POST -H "Authorization: Bearer <sessionJWT>" \
  -H "Content-Type: application/json" \
  -d '{"doc_date":"2026-06-12","doc_time":"10:30","doc_ref":"","doc_ref_date":"","wh_from":"MMA01","location_from":"SH101","remark":"test","lines":[{"item_code":"02-0006","item_name":"...","unit_code":"ชิ้น","sum_amount":239.61,"wh_code":"MMA01","shelf_code":"SH101","stand_value":1,"divide_value":1}]}' \
  http://localhost:3000/api/v1/stock-adjust
```

---

## 📦 Reference

| File | Path |
|---|---|
| Migration plan เต็ม | `docs/smlnesservice-migration-plan.md` (ใน repo NextStep_Stock_Adjust) |
| Frontend ที่ migrate แล้ว | branch `feat/smlnes-migration` ของ NextStep_Stock_Adjust |
| Source ของ business logic เดิม | `NextStep_Stock_Adjust/src/actions/stock-adjust.ts` ของ branch `main` |
| Pattern reference | `smlnesservice/src/modules/credit-note/` (อย่าแก้!) |
