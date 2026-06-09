'use client';

import { ReactNode } from 'react';
import { SidebarProvider, useSidebar } from '@/context/SidebarContext';
import { useAuth } from '@/context/AuthContext';
import Sidebar from '@/components/layout/Sidebar';
import Header from '@/components/layout/Header';

function MainContent({ children }: { children: ReactNode }) {
  const { isCollapsed, isMobile } = useSidebar();
  const marginClass = isMobile ? 'ml-0' : (isCollapsed ? 'ml-16' : 'ml-64');
  
  return (
    <div className={`flex-1 transition-all duration-300 ${marginClass}`}>
      <Header />
      <main className="p-4 md:p-6">{children}</main>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="w-12 h-12 border-4 border-purple-600 border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="mt-4 text-gray-600">กำลังโหลด...</p>
      </div>
    </div>
  );
}

export default function ClientLayout({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <LoadingScreen />;
  }

  if (!user || !user.selected_database) {
    return null; // Route protection in AuthContext will redirect
  }

  return (
    <SidebarProvider>
      <div className="flex min-h-screen bg-gray-50">
        <Sidebar />
        <MainContent>{children}</MainContent>
      </div>
    </SidebarProvider>
  );
}
