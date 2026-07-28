/**
 * กฎการกระจายจำนวนที่ต้องตัด ลงที่เก็บ — ใช้กับเมนู "ปรับปรุงสต็อกสินค้า (ลด)" (IS)
 *
 * แยกออกมาจาก component เพราะเป็น pure logic ที่เป็นหัวใจของเมนู — เทสได้ตรงๆ
 * ทุกจำนวนในไฟล์นี้อยู่ในหน่วย **unit_standard** (หน่วยเดียวกับ ItemLocation.stock_qty)
 */

/** ตัดทศนิยมส่วนเกินของ float (0.1+0.2 = 0.30000000000000004) */
export function roundQty(n: number, digits = 5): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export interface AllocatableLocation {
  wh_code: string;
  shelf_code: string;
  /** คงเหลือใน unit_standard */
  stock_qty: number;
}

export interface Allocation<T extends AllocatableLocation> {
  loc: T;
  /** จำนวนที่ตัดจากที่เก็บนี้ ใน unit_standard */
  qty_std: number;
}

/**
 * จัดสรรจำนวนที่ต้องตัดลงที่เก็บ — ไล่จากที่เก็บที่ **มีของมากสุดก่อน**
 * ตัดจนหมดที่เก็บนั้นแล้วค่อยไปที่ถัดไป จนครบจำนวน
 *
 * - ข้ามที่เก็บที่คงเหลือ ≤ 0
 * - tie-break ด้วย wh_code → shelf_code ให้ผลลัพธ์ deterministic
 * - คืน `null` ถ้าคงเหลือรวมทุกที่เก็บไม่พอ (caller แปลงเป็น error ของทั้งแถว —
 *   ไม่ตัดบางส่วน เพราะแปลว่าข้อมูลที่กรอกมาผิด)
 */
export function allocateReduce<T extends AllocatableLocation>(
  requestedStd: number,
  locations: T[],
): Allocation<T>[] | null {
  const positive = locations.filter((l) => l.stock_qty > 0);
  const totalStd = roundQty(positive.reduce((s, l) => s + l.stock_qty, 0));
  if (roundQty(requestedStd) > totalStd) return null;

  const sorted = [...positive].sort(
    (a, b) =>
      b.stock_qty - a.stock_qty ||
      a.wh_code.localeCompare(b.wh_code) ||
      a.shelf_code.localeCompare(b.shelf_code),
  );

  const out: Allocation<T>[] = [];
  let remaining = requestedStd;
  for (const loc of sorted) {
    if (roundQty(remaining) <= 0) break;
    const take = roundQty(Math.min(remaining, loc.stock_qty));
    if (take <= 0) continue;
    out.push({ loc, qty_std: take });
    remaining = roundQty(remaining - take);
  }
  return out;
}

/** คงเหลือรวมของทุกที่เก็บที่มีของ (unit_standard) */
export function totalAvailable(locations: AllocatableLocation[]): number {
  return roundQty(
    locations.filter((l) => l.stock_qty > 0).reduce((s, l) => s + l.stock_qty, 0),
  );
}
