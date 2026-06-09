'use client';

import { useState } from 'react';
import { Menu, LogOut, ChevronDown } from 'lucide-react';
import { useTheme } from '@/context/ThemeContext';
import { useAuth } from '@/context/AuthContext';
import { useSidebar } from '@/context/SidebarContext';

export default function Header() {
  const { config } = useTheme();
  const { user, logout } = useAuth();
  const { toggleSidebar } = useSidebar();
  const [showUserDropdown, setShowUserDropdown] = useState(false);

  const userInitial = user?.user_name?.charAt(0).toUpperCase() || 'U';
  const userName = user?.user_name || 'Guest';

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-gray-200 bg-white px-4 md:px-6">
      <div className="flex items-center gap-4">
        <button
          onClick={toggleSidebar}
          className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"
          title="Toggle Sidebar"
        >
          <Menu className="h-5 w-5" />
        </button>
        <h1 className="hidden md:block text-base font-semibold text-gray-800">
          ปรับปรุงสินค้า/วัตถุดิบ
        </h1>
      </div>

      <div className="flex items-center gap-2 md:gap-3">
        <div className="relative ml-2 border-l pl-2 md:pl-4">
          <button
            onClick={() => setShowUserDropdown(!showUserDropdown)}
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-gray-100 transition-colors"
          >
            <div
              className={`h-8 w-8 overflow-hidden rounded-full bg-gradient-to-br ${config.gradient1} flex items-center justify-center`}
            >
              <span className="text-white font-bold text-xs">{userInitial}</span>
            </div>
            <span className="hidden md:block text-sm font-medium text-gray-900">
              {userName}
            </span>
            <ChevronDown
              className={`h-4 w-4 text-gray-500 transition-transform ${showUserDropdown ? 'rotate-180' : ''}`}
            />
          </button>

          {showUserDropdown && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setShowUserDropdown(false)}
              />

              <div className="absolute right-0 top-full mt-2 w-56 bg-white rounded-xl shadow-lg border border-gray-200 py-2 z-50">
                <div className="px-4 py-3 border-b border-gray-100">
                  <p className="text-sm font-medium text-gray-900">{userName}</p>
                  <p className="text-xs text-gray-500 mt-1">รหัส: {user?.user_code || '-'}</p>
                </div>

                <div className="px-4 py-3 border-b border-gray-100 bg-purple-50">
                  <p className="text-xs text-purple-600 font-medium">ฐานข้อมูล</p>
                  <p className="text-sm font-medium text-gray-900 mt-1">
                    {user?.selected_database_name || '-'}
                  </p>
                  <p className="text-xs text-gray-500">Provider: {user?.provider || '-'}</p>
                </div>

                <div className="px-2 pt-2">
                  <button
                    onClick={() => {
                      setShowUserDropdown(false);
                      logout();
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <LogOut className="h-4 w-4" />
                    ออกจากระบบ
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
