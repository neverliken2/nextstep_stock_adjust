'use client';

import { useEffect, useRef, useState } from 'react';
import { X, Search } from 'lucide-react';
import { searchItems, type ItemOption } from '@/actions/stock-adjust';

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (item: ItemOption) => void;
}

const PAGE_SIZE = 30;
/** debounce ตอนพิมพ์ค้นหา — กัน query รัวๆ ใน DB */
const SEARCH_DEBOUNCE_MS = 250;

export default function ItemPickerModal({ open, onClose, onSelect }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ItemOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // sentinel สำหรับ IntersectionObserver
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadingRef = useRef(false);
  // ใช้เช็คว่า query ปัจจุบันเปลี่ยนระหว่าง async หรือยัง (กัน race)
  const queryRef = useRef('');

  // โหลดหน้าแรกตอน open + reload เมื่อ query เปลี่ยน (มี debounce)
  useEffect(() => {
    if (!open) return;

    queryRef.current = query;
    let cancelled = false;

    const timer = setTimeout(() => {
      (async () => {
        setLoading(true);
        loadingRef.current = true;
        setResults([]);
        setHasMore(false);
        setError(null);
        try {
          const res = await searchItems(query, 0, PAGE_SIZE);
          // ถ้า query เปลี่ยนแล้ว → ผลลัพธ์นี้ outdated ทิ้งไป
          if (cancelled || queryRef.current !== query) return;
          setResults(res.rows);
          setHasMore(res.has_more);
        } catch (e) {
          if (!cancelled) setError(e instanceof Error ? e.message : 'load fail');
        } finally {
          if (!cancelled) {
            setLoading(false);
            loadingRef.current = false;
          }
        }
      })();
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query]);

  // Lazy load หน้าถัดไปด้วย IntersectionObserver
  useEffect(() => {
    if (!open || !hasMore) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const obs = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting) return;
        if (loadingRef.current) return;

        loadingRef.current = true;
        setLoading(true);

        (async () => {
          const currentQuery = query;
          try {
            const res = await searchItems(
              currentQuery,
              results.length,
              PAGE_SIZE
            );
            // กัน race: ถ้า query เปลี่ยนระหว่างรอ ทิ้งผลลัพธ์
            if (queryRef.current !== currentQuery) return;
            setResults((prev) => [...prev, ...res.rows]);
            setHasMore(res.has_more);
          } catch (e) {
            setError(e instanceof Error ? e.message : 'load fail');
          } finally {
            setLoading(false);
            loadingRef.current = false;
          }
        })();
      },
      { rootMargin: '100px' }
    );

    obs.observe(sentinel);
    return () => obs.disconnect();
  }, [open, hasMore, query, results.length]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex w-full max-w-3xl flex-col rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-lg font-semibold text-gray-900">ค้นหาสินค้า</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-gray-500 hover:bg-gray-100"
            aria-label="ปิด"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="border-b p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="พิมพ์รหัสหรือชื่อสินค้า... (เว้นว่างเพื่อดูทั้งหมด)"
              className="w-full rounded-lg border border-gray-300 py-2 pl-10 pr-3 text-sm focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
            />
          </div>
        </div>

        <div className="max-h-[70vh] overflow-y-auto">
          {error && (
            <div className="p-4 text-center text-sm text-red-600">
              เกิดข้อผิดพลาด: {error}
            </div>
          )}

          {results.length === 0 && !loading && !error && (
            <div className="p-8 text-center text-sm text-gray-500">
              ไม่พบสินค้า
            </div>
          )}

          {results.length > 0 && (
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-gray-50 text-xs text-gray-600">
                <tr>
                  <th className="px-3 py-2 text-left">รหัส</th>
                  <th className="px-3 py-2 text-left">ชื่อสินค้า</th>
                  <th className="px-3 py-2 text-left">หน่วย</th>
                  <th className="px-3 py-2 text-right">ทุนเฉลี่ย</th>
                </tr>
              </thead>
              <tbody>
                {results.map((it, idx) => (
                  <tr
                    key={`${it.code}-${idx}`}
                    className="cursor-pointer border-t hover:bg-purple-50"
                    onClick={() => {
                      onSelect(it);
                      onClose();
                    }}
                  >
                    <td className="px-3 py-2 font-mono text-xs">{it.code}</td>
                    <td className="px-3 py-2">{it.name}</td>
                    <td className="px-3 py-2 text-gray-600">{it.unit_standard}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                      {it.average_cost.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 5,
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {loading && (
            <div className="p-4 text-center text-sm text-gray-500">
              กำลังโหลด...
            </div>
          )}

          {hasMore && !loading && (
            <div ref={sentinelRef} className="h-4" aria-hidden="true" />
          )}

          {!hasMore && results.length > 0 && !loading && (
            <div className="p-3 text-center text-xs text-gray-400">
              — แสดงครบแล้ว ({results.length} รายการ) —
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
