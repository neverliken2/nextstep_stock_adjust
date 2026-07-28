'use client';

import { createContext, useContext, useState, useEffect, useCallback, useSyncExternalStore, ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { destroySession } from '@/actions/session';
import { loginUser, selectDatabase as selectDatabaseAction } from '@/actions/auth';

// Session timeout: 30 minutes
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

export interface UserDatabase {
  code: string;
  database_name: string;
  name: string;
}

export interface User {
  user_code: string;
  user_name: string;
  user_level: number;
  provider: string;
  data_group: string;
  selected_database?: string;
  selected_database_name?: string;
  /** สิทธิ์เมนู "สินค้า/วัตถุดิบ คงเหลือยกมา" (menu_ic_stk_balance) — จาก login response */
  can_stock_balance?: boolean;
  /** สิทธิ์เมนู "ปรับปรุงสต็อกทุกที่เก็บ (ลด)" (menu_ic_stk_adjust_subtract) — จาก login response */
  can_stock_adjust_reduce?: boolean;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  availableDatabases: UserDatabase[];
  login: (provider: string, dataGroup: string, username: string, password: string) => Promise<{ success: boolean; message: string; needSelectDatabase?: boolean }>;
  selectDatabase: (database: UserDatabase) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Public routes that don't require authentication
const PUBLIC_ROUTES = ['/login'];

function loadStoredUser(): User | null {
  if (typeof window === 'undefined') return null;
  const savedUser = localStorage.getItem('nextstep_ia_user');
  if (!savedUser) return null;

  try {
    return JSON.parse(savedUser) as User;
  } catch {
    localStorage.removeItem('nextstep_ia_user');
    localStorage.removeItem('nextstep_ia_databases');
    return null;
  }
}

function loadStoredDatabases(): UserDatabase[] {
  if (typeof window === 'undefined') return [];
  const savedDatabases = localStorage.getItem('nextstep_ia_databases');
  if (!savedDatabases) return [];

  try {
    return JSON.parse(savedDatabases) as UserDatabase[];
  } catch {
    localStorage.removeItem('nextstep_ia_databases');
    return [];
  }
}

/**
 * subscribe ที่ไม่มีวันเปลี่ยน — ใช้กับ useSyncExternalStore เพื่อถาม "hydrate เสร็จหรือยัง"
 * (ประกาศนอก component กัน re-subscribe ทุก render)
 */
const neverChanges = () => () => {};

export function AuthProvider({ children }: { children: ReactNode }) {
  /**
   * `loadStoredUser()` อ่าน localStorage → ฝั่ง server คืน null เสมอ แต่ฝั่ง client คืนค่าจริง
   * ถ้าปล่อยให้ render แรกของ client ใช้ค่าจริงเลย tree จะไม่ตรงกับ HTML ที่ SSR ส่งมา
   * → hydration mismatch (ClientLayout ฝั่ง server return null, ฝั่ง client return <div>)
   *
   * useSyncExternalStore คืน getServerSnapshot (false) ทั้งตอน SSR **และตอน hydrate**
   * แล้วค่อยสลับเป็น true หลัง hydrate เสร็จ → render แรกสองฝั่งตรงกัน
   * ระหว่างนั้น isLoading = true ทำให้ ClientLayout โชว์ LoadingScreen ซึ่ง markup เหมือนกันทั้งคู่
   */
  const isHydrated = useSyncExternalStore(
    neverChanges,
    () => true,
    () => false,
  );
  const [user, setUser] = useState<User | null>(() => loadStoredUser());
  const [availableDatabases, setAvailableDatabases] = useState<UserDatabase[]>(() => loadStoredDatabases());
  const isLoading = !isHydrated;
  const [lastActivity, setLastActivity] = useState(() => Date.now());
  const router = useRouter();
  const pathname = usePathname();

  // Update activity timestamp
  const updateActivity = useCallback(() => {
    setLastActivity(Date.now());
  }, []);

  const performLogout = useCallback(async () => {
    // ลบ session cookie ที่ server
    await destroySession();
    
    setUser(null);
    setAvailableDatabases([]);
    localStorage.removeItem('nextstep_ia_user');
    localStorage.removeItem('nextstep_ia_databases');
    router.push('/login');
  }, [router]);

  // Session timeout checker
  useEffect(() => {
    if (!user) return;

    const checkSession = () => {
      if (Date.now() - lastActivity >= SESSION_TIMEOUT_MS) {
        void performLogout();
      }
    };

    const interval = setInterval(checkSession, 60000); // Check every minute
    return () => clearInterval(interval);
  }, [user, lastActivity, performLogout]);

  // Activity listener
  useEffect(() => {
    if (!user) return;

    const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];
    events.forEach(event => window.addEventListener(event, updateActivity, { passive: true }));

    return () => {
      events.forEach(event => window.removeEventListener(event, updateActivity));
    };
  }, [user, updateActivity]);

  // Route protection
  useEffect(() => {
    if (isLoading) return;

    const isPublicRoute = PUBLIC_ROUTES.some(route => pathname?.startsWith(route));

    if (!user && !isPublicRoute) {
      router.push('/login');
    } else if (user && !user.selected_database && pathname !== '/select-database' && !isPublicRoute) {
      router.push('/select-database');
    }
  }, [user, pathname, isLoading, router]);

  const login = async (provider: string, dataGroup: string, username: string, password: string) => {
    try {
      // ใช้ Server Action แทน fetch API
      const result = await loginUser(provider, dataGroup, username, password);

      if (result.success && result.user) {
        const userData: User = {
          user_code: result.user.user_code,
          user_name: result.user.user_name,
          user_level: result.user.user_level || 0,
          provider,
          data_group: dataGroup,
          can_stock_balance: result.canStockBalance ?? false,
          can_stock_adjust_reduce: result.canStockAdjustReduce ?? false,
        };
        
        // Session cookie ถูกสร้างใน loginUser แล้ว
        
        setUser(userData);
        setAvailableDatabases(result.databases || []);
        setLastActivity(Date.now());
        
        localStorage.setItem('nextstep_ia_user', JSON.stringify(userData));
        localStorage.setItem('nextstep_ia_databases', JSON.stringify(result.databases || []));
        
        return { 
          success: true, 
          message: 'Login successful', 
          needSelectDatabase: (result.databases?.length || 0) > 0 
        };
      }
      
      return { success: false, message: result.message || 'Login failed' };
    } catch (error) {
      console.error('Login error:', error);
      return { success: false, message: 'ไม่สามารถเชื่อมต่อได้ กรุณาลองใหม่' };
    }
  };

  const selectDatabase = async (database: UserDatabase) => {
    if (!user) return;
    
    // เรียก smlnesservice /auth/select-database ผ่าน server action
    // → แลก preSelectJWT เป็น sessionJWT + อัพเดท session cookie
    const result = await selectDatabaseAction(database.database_name);

    if (!result.success) {
      console.error('Failed to select database:', result.message);
      void performLogout();
      return;
    }
    
    const updatedUser: User = {
      ...user,
      selected_database: database.database_name,
      selected_database_name: database.name,
    };
    
    setUser(updatedUser);
    localStorage.setItem('nextstep_ia_user', JSON.stringify(updatedUser));
    router.push('/stock-adjust');
  };

  const logout = () => {
    void performLogout();
  };

  return (
    <AuthContext.Provider value={{ 
      user, 
      isLoading, 
      availableDatabases, 
      login, 
      selectDatabase, 
      logout 
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
