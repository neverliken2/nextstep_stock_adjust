'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useTheme } from '@/context/ThemeContext';
import { useSidebar } from '@/context/SidebarContext';
import { menuItems } from '@/config/menuConfig';

export default function Sidebar() {
  const pathname = usePathname();
  const { config } = useTheme();
  const { isCollapsed, isMobile, isOpen, closeSidebar } = useSidebar();

  const sidebarWidth = isMobile ? 'w-64' : (isCollapsed ? 'w-16' : 'w-64');

  return (
    <>
      {isMobile && isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 transition-opacity"
          onClick={closeSidebar}
        />
      )}

      <aside
        className={cn(
          'fixed left-0 top-0 z-40 h-screen bg-gradient-to-b transition-all duration-300',
          config.sidebar,
          sidebarWidth,
          isMobile && !isOpen && '-translate-x-full',
          isMobile && isOpen && 'translate-x-0'
        )}
      >
        <div className="flex h-20 items-center px-4">
          <div className="flex items-center gap-2">
            <Image
              src="/Logo.png"
              alt="NextStep Logo"
              width={45}
              height={45}
              className="object-contain"
            />
            {(isMobile || !isCollapsed) && (
              <span className="text-base font-bold text-white">NextStep IA</span>
            )}
          </div>
        </div>

        <nav className="h-[calc(100vh-5rem)] overflow-y-auto px-3 py-4">
          <ul className="space-y-2">
            {menuItems.map((item) => {
              const Icon = item.icon;
              const isPrefix =
                pathname === item.href || pathname.startsWith(item.href + '/');
              // ถ้าเมนูอื่นมี href ที่ match ลึกกว่า → ไม่ถือว่าเมนูนี้ active
              // กันเคส parent (/stock-adjust) ติด active พร้อม child (/stock-adjust/bulk)
              const hasDeeperMatch = menuItems.some(
                (o) =>
                  o.href !== item.href &&
                  o.href.length > item.href.length &&
                  (pathname === o.href || pathname.startsWith(o.href + '/'))
              );
              const isActive = isPrefix && !hasDeeperMatch;

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => isMobile && closeSidebar()}
                    className={cn(
                      'flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-bold transition-all border-l-4',
                      isActive
                        ? 'bg-white/25 text-white border-white shadow-lg'
                        : 'text-white/90 hover:bg-white/15 hover:text-white border-transparent hover:border-white/50',
                      !isMobile && isCollapsed && 'justify-center border-l-0'
                    )}
                    title={!isMobile && isCollapsed ? item.label : undefined}
                  >
                    <Icon className="h-5 w-5 flex-shrink-0" />
                    {(isMobile || !isCollapsed) && <span>{item.label}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </aside>
    </>
  );
}
