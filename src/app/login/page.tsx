'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { useAuth } from '@/context/AuthContext';
import { Eye, EyeOff, LogIn, Database, User, Lock, Layers } from 'lucide-react';

function loadRememberedLogin() {
  if (typeof window === 'undefined') {
    return { provider: '', dataGroup: '', username: '', rememberMe: false };
  }

  const saved = localStorage.getItem('nextstep_remember');
  if (!saved) {
    return { provider: '', dataGroup: '', username: '', rememberMe: false };
  }

  try {
    const remembered = JSON.parse(saved);
    return {
      provider: remembered.provider || '',
      dataGroup: remembered.dataGroup || '',
      username: remembered.username || '',
      rememberMe: true,
    };
  } catch {
    localStorage.removeItem('nextstep_remember');
    return { provider: '', dataGroup: '', username: '', rememberMe: false };
  }
}

export default function LoginPage() {
  const [rememberedLogin] = useState(() => loadRememberedLogin());
  const [provider, setProvider] = useState(rememberedLogin.provider);
  const [dataGroup, setDataGroup] = useState(rememberedLogin.dataGroup);
  const [username, setUsername] = useState(rememberedLogin.username);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(rememberedLogin.rememberMe);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  
  const { login } = useAuth();
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const result = await login(provider, dataGroup, username, password);
      
      if (result.success) {
        // Save credentials if remember me
        if (rememberMe) {
          localStorage.setItem('nextstep_remember', JSON.stringify({ provider, dataGroup, username }));
        } else {
          localStorage.removeItem('nextstep_remember');
        }

        if (result.needSelectDatabase) {
          router.push('/select-database');
        } else {
          router.push('/');
        }
      } else {
        setError(result.message);
      }
    } catch {
      setError('เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-purple-800 to-indigo-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
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
          <p className="text-purple-200 mt-2">ปรับปรุงสินค้า/วัตถุดิบ</p>
        </div>

        {/* Login Card */}
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <h2 className="text-2xl font-bold text-gray-800 text-center mb-6">
            เข้าสู่ระบบ
          </h2>

          {/* Error Message */}
          {error && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-600 text-sm text-center">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Provider Input */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Provider
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Database className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  type="text"
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                  placeholder="เช่น data, demo, test"
                  className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all text-gray-900 placeholder-gray-400"
                  required
                />
              </div>
              <p className="mt-1 text-xs text-gray-500">
                Database: smlerpmain + provider
              </p>
            </div>

            {/* Data Group Input */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                กลุ่มข้อมูล
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Layers className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  type="text"
                  value={dataGroup}
                  onChange={(e) => setDataGroup(e.target.value)}
                  placeholder="เช่น SML, NKK"
                  className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all text-gray-900 placeholder-gray-400"
                  required
                />
              </div>
            </div>

            {/* Username Input */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Username
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <User className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="กรอก User Code"
                  className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all text-gray-900 placeholder-gray-400"
                  required
                />
              </div>
            </div>

            {/* Password Input */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="กรอกรหัสผ่าน"
                  className="w-full pl-10 pr-12 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all text-gray-900 placeholder-gray-400"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center"
                >
                  {showPassword ? (
                    <EyeOff className="h-5 w-5 text-gray-400 hover:text-gray-600" />
                  ) : (
                    <Eye className="h-5 w-5 text-gray-400 hover:text-gray-600" />
                  )}
                </button>
              </div>
            </div>

            {/* Remember Me */}
            <div className="flex items-center">
              <input
                type="checkbox"
                id="rememberMe"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
              />
              <label htmlFor="rememberMe" className="ml-2 text-sm text-gray-600">
                จำข้อมูลการเข้าสู่ระบบ
              </label>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 px-4 bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-medium rounded-lg hover:from-purple-700 hover:to-indigo-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <>
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  <span>กำลังเข้าสู่ระบบ...</span>
                </>
              ) : (
                <>
                  <LogIn className="h-5 w-5" />
                  <span>เข้าสู่ระบบ</span>
                </>
              )}
            </button>
          </form>
        </div>

        {/* Footer */}
        <p className="text-center text-purple-200 text-sm mt-6">
          © 2025 NextStep Software & Hardware. All rights reserved.
        </p>
        <p className="text-center text-purple-300/50 text-xs mt-2">
          v1.0.1
        </p>
      </div>
    </div>
  );
}
