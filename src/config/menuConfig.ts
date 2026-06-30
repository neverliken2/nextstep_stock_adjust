import { Package, Layers, LucideIcon } from 'lucide-react';

export interface MenuItem {
  icon: LucideIcon;
  label: string;
  href: string;
}

export const menuItems: MenuItem[] = [
  { icon: Package, label: 'ปรับปรุงสินค้า', href: '/stock-adjust' },
  { icon: Layers, label: 'ปรับต้นทุนทุกที่เก็บ', href: '/stock-adjust/bulk' },
];
