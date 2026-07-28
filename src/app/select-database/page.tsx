'use client';

import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import Image from 'next/image';
import { Database, Check, LogOut } from 'lucide-react';

export default function SelectDatabasePage() {
  const { user, isLoading, availableDatabases, selectDatabase, logout } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      router.push('/login');
    } else if (user.selected_database) {
      router.push('/');
    }
  }, [user, isLoading, router]);

  // isLoading = ยัง hydrate ไม่เสร็จ → ฝั่ง server ยังไม่รู้จัก user (localStorage)
  // ต้อง render เหมือนกันทั้งสองฝั่ง ไม่งั้น hydration mismatch
  if (isLoading || !user || user.selected_database) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-purple-800 to-indigo-900 flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <Image
              src="/Logo.png"
              alt="NextStep Logo"
              width={80}
              height={80}
              className="object-contain"
            />
          </div>
          <h1 className="text-3xl font-bold text-white">NextStep</h1>
          <p className="text-purple-200 mt-2">เลือกฐานข้อมูลที่ต้องการใช้งาน</p>
        </div>

        {/* User Info */}
        <div className="bg-purple-700/50 rounded-xl p-4 mb-6 text-center">
          <p className="text-purple-100">ผู้ใช้: <span className="font-semibold text-white">{user.user_name}</span> ({user.user_code})</p>
          <p className="text-purple-200 text-sm mt-1">Provider: {user.provider} | กลุ่ม: {user.data_group}</p>
        </div>

        {/* Database List */}
        <div className="bg-white rounded-2xl shadow-2xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <Database className="h-5 w-5 text-purple-600" />
            <h2 className="text-lg font-semibold text-gray-800">เลือกฐานข้อมูล</h2>
          </div>

          {availableDatabases.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p>ไม่พบฐานข้อมูลที่มีสิทธิ์เข้าถึง</p>
              <button
                onClick={logout}
                className="mt-4 text-red-600 hover:text-red-700 flex items-center gap-1 mx-auto"
              >
                <LogOut className="h-4 w-4" />
                ออกจากระบบ
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {availableDatabases.map((db) => (
                <button
                  key={db.code}
                  onClick={() => selectDatabase(db)}
                  className="w-full flex items-center justify-between p-4 rounded-xl border-2 border-gray-200 hover:border-purple-500 hover:bg-purple-50 transition-all group"
                >
                  <div className="text-left">
                    <p className="font-medium text-gray-900 group-hover:text-purple-700">{db.name}</p>
                    <p className="text-sm text-gray-500">Database: {db.database_name}</p>
                    <p className="text-xs text-gray-400">Code: {db.code}</p>
                  </div>
                  <Check className="h-5 w-5 text-purple-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Logout */}
        <div className="text-center mt-6">
          <button
            onClick={logout}
            className="text-purple-200 hover:text-white transition-colors flex items-center gap-2 mx-auto"
          >
            <LogOut className="h-4 w-4" />
            ออกจากระบบ
          </button>
        </div>

        {/* Footer */}
        <p className="text-center text-purple-200 text-sm mt-6">
          © 2025 NextStep Software & Hardware. All rights reserved.
        </p>
      </div>
    </div>
  );
}
