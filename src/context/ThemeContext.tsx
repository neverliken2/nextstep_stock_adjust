'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export type ThemeColor = 'purple' | 'orange' | 'blue' | 'green' | 'red' | 'dark';
export type FontColor = 'default' | 'dark' | 'light' | 'blue' | 'green' | 'purple';

interface FontColorConfig {
  name: string;
  primary: string;
  secondary: string;
  muted: string;
  heading: string;
  body: string;
  link: string;
  success: string;
  warning: string;
  error: string;
}

export const fontColors: Record<FontColor, FontColorConfig> = {
  default: {
    name: 'ค่าเริ่มต้น',
    primary: '#1f2937',
    secondary: '#4b5563',
    muted: '#9ca3af',
    heading: '#111827',
    body: '#374151',
    link: '#3b82f6',
    success: '#10b981',
    warning: '#f59e0b',
    error: '#ef4444',
  },
  dark: {
    name: 'เข้ม',
    primary: '#030712',
    secondary: '#1f2937',
    muted: '#6b7280',
    heading: '#000000',
    body: '#111827',
    link: '#2563eb',
    success: '#059669',
    warning: '#d97706',
    error: '#dc2626',
  },
  light: {
    name: 'อ่อน',
    primary: '#6b7280',
    secondary: '#9ca3af',
    muted: '#d1d5db',
    heading: '#4b5563',
    body: '#6b7280',
    link: '#60a5fa',
    success: '#34d399',
    warning: '#fbbf24',
    error: '#f87171',
  },
  blue: {
    name: 'น้ำเงิน',
    primary: '#1e40af',
    secondary: '#3b82f6',
    muted: '#93c5fd',
    heading: '#1e3a8a',
    body: '#1d4ed8',
    link: '#2563eb',
    success: '#10b981',
    warning: '#f59e0b',
    error: '#ef4444',
  },
  green: {
    name: 'เขียว',
    primary: '#065f46',
    secondary: '#10b981',
    muted: '#6ee7b7',
    heading: '#064e3b',
    body: '#047857',
    link: '#3b82f6',
    success: '#10b981',
    warning: '#f59e0b',
    error: '#ef4444',
  },
  purple: {
    name: 'ม่วง',
    primary: '#5b21b6',
    secondary: '#8b5cf6',
    muted: '#c4b5fd',
    heading: '#4c1d95',
    body: '#6d28d9',
    link: '#3b82f6',
    success: '#10b981',
    warning: '#f59e0b',
    error: '#ef4444',
  },
};

interface ThemeConfig {
  name: string;
  sidebar: string;
  logoBg: string;
  logoText: string;
  primary: string;
  primaryHover: string;
  primaryLight: string;
  primaryIcon: string;
  chartColor: string;
  gradient1: string;
  gradient2: string;
  // Extended colors for UI components
  inputBg: string;
  inputBorder: string;
  inputText: string;
  inputPlaceholder: string;
  badgeBg: string;
  badgeText: string;
  headerGradient: string;
  accentLight: string;
  accentText: string;
  hoverBg: string;
  // Table colors
  tableHeader: string;
  tableFooter: string;
  // CSS hex colors for inline styles
  colors: {
    primary: string;
    primaryLight: string;
    primaryDark: string;
    secondary: string;
    text: string;
    textLight: string;
    border: string;
    gradient: { from: string; via: string; to: string };
    gradientDark: { from: string; via: string; to: string };
  };
}

export const themes: Record<ThemeColor, ThemeConfig> = {
  purple: {
    name: 'Purple',
    sidebar: 'from-purple-600 via-purple-700 to-pink-600',
    logoBg: 'bg-yellow-400',
    logoText: 'text-purple-700',
    primary: 'bg-purple-600',
    primaryHover: 'hover:bg-purple-700',
    primaryLight: 'bg-purple-100',
    primaryIcon: 'text-purple-600',
    chartColor: '#8b5cf6',
    gradient1: 'from-purple-500 to-purple-600',
    gradient2: 'from-pink-500 to-pink-600',
    inputBg: 'from-purple-100 via-fuchsia-100 to-pink-100',
    inputBorder: 'border-purple-200',
    inputText: 'text-purple-700',
    inputPlaceholder: 'placeholder-purple-300',
    badgeBg: 'bg-purple-100',
    badgeText: 'text-purple-700',
    headerGradient: 'from-purple-600 via-fuchsia-600 to-pink-600',
    accentLight: 'bg-purple-200 hover:bg-purple-300',
    accentText: 'text-purple-600',
    hoverBg: 'hover:from-purple-50 hover:to-pink-50',
    tableHeader: 'bg-gradient-to-r from-purple-600 via-purple-700 to-fuchsia-600',
    tableFooter: 'bg-gradient-to-r from-purple-700 via-purple-800 to-fuchsia-700',
    colors: {
      primary: '#9333ea',
      primaryLight: '#f3e8ff',
      primaryDark: '#7e22ce',
      secondary: '#ec4899',
      text: '#6b21a8',
      textLight: '#a855f7',
      border: '#e9d5ff',
      gradient: { from: '#9333ea', via: '#c026d3', to: '#ec4899' },
      gradientDark: { from: '#7e22ce', via: '#a21caf', to: '#be185d' },
    },
  },
  orange: {
    name: 'Orange',
    sidebar: 'from-orange-400 via-orange-500 to-rose-500',
    logoBg: 'bg-yellow-300',
    logoText: 'text-orange-600',
    primary: 'bg-orange-500',
    primaryHover: 'hover:bg-orange-600',
    primaryLight: 'bg-orange-100',
    primaryIcon: 'text-orange-600',
    chartColor: '#f97316',
    gradient1: 'from-orange-500 to-orange-600',
    gradient2: 'from-red-500 to-red-600',
    inputBg: 'from-orange-100 via-amber-100 to-yellow-100',
    inputBorder: 'border-orange-200',
    inputText: 'text-orange-700',
    inputPlaceholder: 'placeholder-orange-300',
    badgeBg: 'bg-orange-100',
    badgeText: 'text-orange-700',
    headerGradient: 'from-orange-500 via-amber-500 to-yellow-500',
    accentLight: 'bg-orange-200 hover:bg-orange-300',
    accentText: 'text-orange-600',
    hoverBg: 'hover:from-orange-50 hover:to-yellow-50',
    tableHeader: 'bg-gradient-to-r from-orange-500 via-orange-600 to-amber-500',
    tableFooter: 'bg-gradient-to-r from-orange-600 via-orange-700 to-amber-600',
    colors: {
      primary: '#f97316',
      primaryLight: '#ffedd5',
      primaryDark: '#ea580c',
      secondary: '#f59e0b',
      text: '#c2410c',
      textLight: '#fb923c',
      border: '#fed7aa',
      gradient: { from: '#f97316', via: '#f59e0b', to: '#eab308' },
      gradientDark: { from: '#ea580c', via: '#d97706', to: '#ca8a04' },
    },
  },
  blue: {
    name: 'Blue',
    sidebar: 'from-blue-500 via-blue-600 to-indigo-600',
    logoBg: 'bg-cyan-300',
    logoText: 'text-blue-600',
    primary: 'bg-blue-500',
    primaryHover: 'hover:bg-blue-600',
    primaryLight: 'bg-blue-100',
    primaryIcon: 'text-blue-600',
    chartColor: '#3b82f6',
    gradient1: 'from-blue-500 to-blue-600',
    gradient2: 'from-indigo-500 to-indigo-600',
    inputBg: 'from-blue-100 via-sky-100 to-cyan-100',
    inputBorder: 'border-blue-200',
    inputText: 'text-blue-700',
    inputPlaceholder: 'placeholder-blue-300',
    badgeBg: 'bg-blue-100',
    badgeText: 'text-blue-700',
    headerGradient: 'from-blue-500 via-sky-500 to-cyan-500',
    accentLight: 'bg-blue-200 hover:bg-blue-300',
    accentText: 'text-blue-600',
    hoverBg: 'hover:from-blue-50 hover:to-cyan-50',
    tableHeader: 'bg-gradient-to-r from-blue-500 via-blue-600 to-indigo-500',
    tableFooter: 'bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-600',
    colors: {
      primary: '#3b82f6',
      primaryLight: '#dbeafe',
      primaryDark: '#2563eb',
      secondary: '#6366f1',
      text: '#1d4ed8',
      textLight: '#60a5fa',
      border: '#bfdbfe',
      gradient: { from: '#3b82f6', via: '#0ea5e9', to: '#06b6d4' },
      gradientDark: { from: '#2563eb', via: '#0284c7', to: '#0891b2' },
    },
  },
  green: {
    name: 'Green',
    sidebar: 'from-emerald-500 via-emerald-600 to-teal-600',
    logoBg: 'bg-lime-300',
    logoText: 'text-emerald-600',
    primary: 'bg-emerald-500',
    primaryHover: 'hover:bg-emerald-600',
    primaryLight: 'bg-emerald-100',
    primaryIcon: 'text-emerald-600',
    chartColor: '#10b981',
    gradient1: 'from-emerald-500 to-emerald-600',
    gradient2: 'from-teal-500 to-teal-600',
    inputBg: 'from-emerald-100 via-green-100 to-teal-100',
    inputBorder: 'border-emerald-200',
    inputText: 'text-emerald-700',
    inputPlaceholder: 'placeholder-emerald-300',
    badgeBg: 'bg-emerald-100',
    badgeText: 'text-emerald-700',
    headerGradient: 'from-emerald-500 via-green-500 to-teal-500',
    accentLight: 'bg-emerald-200 hover:bg-emerald-300',
    accentText: 'text-emerald-600',
    hoverBg: 'hover:from-emerald-50 hover:to-teal-50',
    tableHeader: 'bg-gradient-to-r from-emerald-500 via-emerald-600 to-teal-500',
    tableFooter: 'bg-gradient-to-r from-emerald-600 via-emerald-700 to-teal-600',
    colors: {
      primary: '#10b981',
      primaryLight: '#d1fae5',
      primaryDark: '#059669',
      secondary: '#14b8a6',
      text: '#047857',
      textLight: '#34d399',
      border: '#a7f3d0',
      gradient: { from: '#10b981', via: '#22c55e', to: '#14b8a6' },
      gradientDark: { from: '#059669', via: '#16a34a', to: '#0d9488' },
    },
  },
  red: {
    name: 'Red',
    sidebar: 'from-red-500 via-red-600 to-rose-600',
    logoBg: 'bg-orange-300',
    logoText: 'text-red-600',
    primary: 'bg-red-500',
    primaryHover: 'hover:bg-red-600',
    primaryLight: 'bg-red-100',
    primaryIcon: 'text-red-600',
    chartColor: '#ef4444',
    gradient1: 'from-red-500 to-red-600',
    gradient2: 'from-rose-500 to-rose-600',
    inputBg: 'from-red-100 via-rose-100 to-pink-100',
    inputBorder: 'border-red-200',
    inputText: 'text-red-700',
    inputPlaceholder: 'placeholder-red-300',
    badgeBg: 'bg-red-100',
    badgeText: 'text-red-700',
    headerGradient: 'from-red-500 via-rose-500 to-pink-500',
    accentLight: 'bg-red-200 hover:bg-red-300',
    accentText: 'text-red-600',
    hoverBg: 'hover:from-red-50 hover:to-pink-50',
    tableHeader: 'bg-gradient-to-r from-red-500 via-red-600 to-rose-500',
    tableFooter: 'bg-gradient-to-r from-red-600 via-red-700 to-rose-600',
    colors: {
      primary: '#ef4444',
      primaryLight: '#fee2e2',
      primaryDark: '#dc2626',
      secondary: '#f43f5e',
      text: '#b91c1c',
      textLight: '#f87171',
      border: '#fecaca',
      gradient: { from: '#ef4444', via: '#f43f5e', to: '#ec4899' },
      gradientDark: { from: '#dc2626', via: '#e11d48', to: '#be185d' },
    },
  },
  dark: {
    name: 'Dark',
    sidebar: 'from-slate-700 via-slate-800 to-gray-900',
    logoBg: 'bg-slate-400',
    logoText: 'text-slate-800',
    primary: 'bg-slate-700',
    primaryHover: 'hover:bg-slate-800',
    primaryLight: 'bg-slate-100',
    primaryIcon: 'text-slate-700',
    chartColor: '#475569',
    gradient1: 'from-slate-600 to-slate-700',
    gradient2: 'from-gray-700 to-gray-800',
    inputBg: 'from-slate-100 via-gray-100 to-zinc-100',
    inputBorder: 'border-slate-200',
    inputText: 'text-slate-700',
    inputPlaceholder: 'placeholder-slate-400',
    badgeBg: 'bg-slate-100',
    badgeText: 'text-slate-700',
    headerGradient: 'from-slate-600 via-gray-600 to-zinc-600',
    accentLight: 'bg-slate-200 hover:bg-slate-300',
    accentText: 'text-slate-600',
    hoverBg: 'hover:from-slate-50 hover:to-zinc-50',
    tableHeader: 'bg-gradient-to-r from-slate-600 via-slate-700 to-gray-600',
    tableFooter: 'bg-gradient-to-r from-slate-700 via-slate-800 to-gray-700',
    colors: {
      primary: '#475569',
      primaryLight: '#f1f5f9',
      primaryDark: '#334155',
      secondary: '#64748b',
      text: '#334155',
      textLight: '#94a3b8',
      border: '#e2e8f0',
      gradient: { from: '#475569', via: '#64748b', to: '#71717a' },
      gradientDark: { from: '#334155', via: '#475569', to: '#52525b' },
    },
  },
};

interface ThemeContextType {
  theme: ThemeColor;
  config: ThemeConfig;
  setTheme: (theme: ThemeColor) => void;
  fontColor: FontColor;
  fontConfig: FontColorConfig;
  setFontColor: (fontColor: FontColor) => void;
  isSettingsOpen: boolean;
  openSettings: () => void;
  closeSettings: () => void;
}

// Default context value to avoid errors before mounting
const defaultContextValue: ThemeContextType = {
  theme: 'purple',
  config: themes.purple,
  setTheme: () => {},
  fontColor: 'default',
  fontConfig: fontColors.default,
  setFontColor: () => {},
  isSettingsOpen: false,
  openSettings: () => {},
  closeSettings: () => {},
};

const ThemeContext = createContext<ThemeContextType>(defaultContextValue);

function loadStoredTheme(): ThemeColor {
  if (typeof window === 'undefined') return 'purple';
  const savedTheme = localStorage.getItem('dashboard-theme') as ThemeColor;
  return savedTheme && themes[savedTheme] ? savedTheme : 'purple';
}

function loadStoredFontColor(): FontColor {
  if (typeof window === 'undefined') return 'default';
  const savedFontColor = localStorage.getItem('dashboard-font-color') as FontColor;
  return savedFontColor && fontColors[savedFontColor] ? savedFontColor : 'default';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeColor>(() => loadStoredTheme());
  const [fontColor, setFontColorState] = useState<FontColor>(() => loadStoredFontColor());
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Apply font colors as CSS variables and override inline styles
  useEffect(() => {
    const fontConfig = fontColors[fontColor];
    const root = document.documentElement;
    
    root.style.setProperty('--font-primary', fontConfig.primary);
    root.style.setProperty('--font-secondary', fontConfig.secondary);
    root.style.setProperty('--font-muted', fontConfig.muted);
    root.style.setProperty('--font-heading', fontConfig.heading);
    root.style.setProperty('--font-body', fontConfig.body);
    root.style.setProperty('--font-link', fontConfig.link);
    root.style.setProperty('--font-success', fontConfig.success);
    root.style.setProperty('--font-warning', fontConfig.warning);
    root.style.setProperty('--font-error', fontConfig.error);
    
    // Function to reset inline styles that were overridden
    const resetInlineStyles = () => {
      const overriddenElements = document.querySelectorAll('[data-original-color]');
      overriddenElements.forEach(el => {
        const htmlEl = el as HTMLElement;
        const originalColor = htmlEl.getAttribute('data-original-color');
        if (originalColor) {
          htmlEl.style.color = originalColor;
          htmlEl.removeAttribute('data-original-color');
        }
      });
    };
    
    // Function to override inline styles
    const overrideInlineStyles = () => {
      const allElements = document.querySelectorAll('*');
      allElements.forEach(el => {
        const htmlEl = el as HTMLElement;
        if (htmlEl.style.color && !htmlEl.closest('.exclude-font-theme') && !htmlEl.classList.contains('text-white')) {
          const currentColor = htmlEl.style.color.toLowerCase();
          // Don't override white text
          if (currentColor !== 'white' && currentColor !== '#fff' && currentColor !== '#ffffff' && currentColor !== 'rgb(255, 255, 255)') {
            // Store original color if not already stored
            if (!htmlEl.hasAttribute('data-original-color')) {
              htmlEl.setAttribute('data-original-color', currentColor);
            }
            htmlEl.style.setProperty('color', fontConfig.body, 'important');
          }
        }
      });
    };
    
    if (fontColor !== 'default') {
      document.body.classList.add('font-theme-active');
      
      // Run after DOM updates
      setTimeout(overrideInlineStyles, 100);
      
      // Use MutationObserver to handle dynamic content
      const observer = new MutationObserver(() => {
        setTimeout(overrideInlineStyles, 50);
      });
      observer.observe(document.body, { childList: true, subtree: true });
      
      return () => observer.disconnect();
    } else {
      document.body.classList.remove('font-theme-active');
      // Reset all overridden inline styles back to original
      resetInlineStyles();
    }
  }, [fontColor]);

  const setTheme = (newTheme: ThemeColor) => {
    console.log('setTheme called with:', newTheme);
    setThemeState(newTheme);
    localStorage.setItem('dashboard-theme', newTheme);
    console.log('Theme saved to localStorage:', localStorage.getItem('dashboard-theme'));
  };

  const setFontColor = (newFontColor: FontColor) => {
    console.log('setFontColor called with:', newFontColor);
    setFontColorState(newFontColor);
    localStorage.setItem('dashboard-font-color', newFontColor);
    console.log('Font color saved to localStorage:', localStorage.getItem('dashboard-font-color'));
  };

  const openSettings = () => setIsSettingsOpen(true);
  const closeSettings = () => setIsSettingsOpen(false);

  return (
    <ThemeContext.Provider
      value={{
        theme,
        config: themes[theme],
        setTheme,
        fontColor,
        fontConfig: fontColors[fontColor],
        setFontColor,
        isSettingsOpen,
        openSettings,
        closeSettings,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
