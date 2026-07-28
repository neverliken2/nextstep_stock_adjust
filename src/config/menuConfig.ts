import { Package, Layers, Archive, TrendingDown, LucideIcon } from 'lucide-react';

/** สิทธิ์เมนูย่อยที่ login response ส่งกลับมา */
export type MenuPermission = 'stock_balance' | 'stock_adjust_reduce';

export interface MenuItem {
  icon: LucideIcon;
  label: string;
  href: string;
  /** ต้องมีสิทธิ์เมนูนี้ (จาก login response) ถึงแสดง — undefined = แสดงเสมอ */
  requires?: MenuPermission;
}

export const menuItems: MenuItem[] = [
  { icon: Package, label: 'ปรับปรุงสินค้า', href: '/stock-adjust' },
  { icon: Layers, label: 'ปรับต้นทุนทุกที่เก็บ', href: '/stock-adjust/bulk' },
  {
    icon: TrendingDown,
    label: 'ปรับปรุงสต็อกสินค้า (ลด)',
    href: '/stock-adjust/bulk-reduce',
    requires: 'stock_adjust_reduce',
  },
  {
    icon: Archive,
    label: 'สินค้า/วัตถุดิบ คงเหลือยกมา',
    href: '/stock-balance',
    requires: 'stock_balance',
  },
];
