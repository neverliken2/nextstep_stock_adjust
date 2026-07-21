import { Package, Layers, Archive, LucideIcon } from 'lucide-react';

export interface MenuItem {
  icon: LucideIcon;
  label: string;
  href: string;
  /** ต้องมีสิทธิ์เมนูนี้ (จาก login response) ถึงแสดง — undefined = แสดงเสมอ */
  requires?: 'stock_balance';
}

export const menuItems: MenuItem[] = [
  { icon: Package, label: 'ปรับปรุงสินค้า', href: '/stock-adjust' },
  { icon: Layers, label: 'ปรับต้นทุนทุกที่เก็บ', href: '/stock-adjust/bulk' },
  {
    icon: Archive,
    label: 'สินค้า/วัตถุดิบ คงเหลือยกมา',
    href: '/stock-balance',
    requires: 'stock_balance',
  },
];
