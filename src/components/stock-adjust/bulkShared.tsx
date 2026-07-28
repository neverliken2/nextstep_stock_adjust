'use client';

/**
 * ชิ้นส่วนที่ใช้ร่วมกันระหว่างหน้า bulk ทั้งสอง:
 *   - BulkStockAdjustForm  (ปรับต้นทุนทุกที่เก็บ — IA, trans_flag=66)
 *   - BulkStockReduceForm  (ปรับปรุงสต็อกสินค้า ลด — IS, trans_flag=68)
 *
 * ทั้งสองหน้าใช้ layout เดียวกัน (header เอกสาร → import bar → preview → save + outcomes)
 * ต่างกันที่ input (ทุนเป้า vs จำนวนที่ลด) และวิธีสร้างแถว preview
 */

import { useEffect, useState } from 'react';

// ──────────────────────────── Formatters ────────────────────────────

export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function nowHHMM(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function formatMoney(n: number): string {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 5,
  });
}

export function formatAmount(n: number, decimal: number): string {
  if (!Number.isFinite(n)) return '-';
  return n.toLocaleString(undefined, {
    minimumFractionDigits: decimal,
    maximumFractionDigits: decimal,
  });
}

/** ตัดทศนิยมส่วนเกินของ float (0.1+0.2 = 0.30000000000000004) */
export function roundQty(n: number, digits = 5): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return `${m}m ${String(rs).padStart(2, '0')}s`;
}

// ──────────────────────────── Progress ────────────────────────────

interface LoadProgressBarProps {
  done: number;
  total: number;
  startedAt: number;
}

/** Progress bar + tick ทุก 500ms ให้ elapsed/ETA วิ่ง */
export function LoadProgressBar({
  done,
  total,
  startedAt,
}: LoadProgressBarProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  const elapsed = Math.max(0, now - startedAt);
  const pct = total > 0 ? (done / total) * 100 : 0;
  const avgPerItem = done > 0 ? elapsed / done : 0;
  const remaining = avgPerItem * (total - done);
  const showEta = done > 0 && done < total;

  return (
    <div className="mt-3 space-y-1">
      <div className="flex flex-wrap items-baseline gap-x-3 text-sm">
        <span className="text-gray-700">
          กำลังโหลดที่เก็บ <b>{done}</b> / {total} item
        </span>
        <span className="text-xs text-gray-500">
          ใช้เวลา {formatDuration(elapsed)}
        </span>
        {showEta && (
          <span className="text-xs text-gray-500">
            · เหลือ ~{formatDuration(Math.round(remaining))}
          </span>
        )}
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
        <div
          className="h-full bg-purple-600 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

interface SaveProgressLineProps {
  done: number;
  total: number;
  startedAt: number;
  allDone: boolean;
  successCount: number;
  failCount: number;
}

export function SaveProgressLine({
  done,
  total,
  startedAt,
  allDone,
  successCount,
  failCount,
}: SaveProgressLineProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (allDone) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [allDone]);

  const elapsed = Math.max(0, now - startedAt);
  const avgPerItem = done > 0 ? elapsed / done : 0;
  const remaining = avgPerItem * (total - done);
  const showEta = done > 0 && done < total && !allDone;

  return (
    <span className="flex flex-wrap items-baseline gap-x-3">
      <span>
        บันทึก <b>{done}</b> / {total} ใบ
      </span>
      <span className="text-xs text-gray-500">{formatDuration(elapsed)}</span>
      {showEta && (
        <span className="text-xs text-gray-500">
          · เหลือ ~{formatDuration(Math.round(remaining))}
        </span>
      )}
      {allDone && (
        <span className="font-semibold">
          — เสร็จสิ้น (
          <span className="text-green-700">{successCount} สำเร็จ</span>
          {failCount > 0 && (
            <>
              , <span className="text-red-700">{failCount} ล้มเหลว</span>
            </>
          )}
          )
        </span>
      )}
    </span>
  );
}

// ──────────────────────────── Styles ────────────────────────────

export const inputClass =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500';

export function Field({
  label,
  children,
  className = '',
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-1 ${className}`}>
      <span className="text-xs font-medium text-gray-600">{label}</span>
      {children}
    </label>
  );
}
