'use client';

import { useEffect, useRef, useState } from 'react';
import { X, History } from 'lucide-react';
import {
  getPurchaseHistory,
  type PurchaseHistoryRow,
} from '@/actions/stock-adjust';

interface Props {
  open: boolean;
  itemCode: string;
  itemName?: string;
  /** จำนวนทศนิยมสำหรับมูลค่า (จาก erp_option.item_amount_decimal) */
  amountDecimal: number;
  onClose: () => void;
}

const PAGE_SIZE = 10;

/** แปลง vat_type → label */
function vatLabel(vat_type: number): string {
  if (vat_type === 1) return 'รวมใน';
  if (vat_type === 2) return 'แยกนอก';
  return 'ไม่มี';
}

/** ISO YYYY-MM-DD → DD/MM/YYYY (ค.ศ.) */
function formatDate(iso: string): string {
  if (!iso || iso.length < 10) return '-';
  const y = iso.slice(0, 4);
  const m = iso.slice(5, 7);
  const d = iso.slice(8, 10);
  return `${d}/${m}/${y}`;
}

function formatNum(n: number, decimal: number): string {
  if (!Number.isFinite(n)) return '-';
  return n.toLocaleString(undefined, {
    minimumFractionDigits: decimal,
    maximumFractionDigits: decimal,
  });
}

export default function PurchaseHistoryModal({
  open,
  itemCode,
  itemName,
  amountDecimal,
  onClose,
}: Props) {
  const [rows, setRows] = useState<PurchaseHistoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // sentinel สำหรับ IntersectionObserver
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // ป้องกัน fetch ซ้ำตอน effect re-run
  const loadingRef = useRef(false);

  // โหลดหน้าแรกตอน open / itemCode เปลี่ยน
  useEffect(() => {
    if (!open || !itemCode) return;

    let cancelled = false;
    setRows([]);
    setHasMore(false);
    setError(null);
    setLoading(true);
    loadingRef.current = true;

    (async () => {
      try {
        const res = await getPurchaseHistory(itemCode, 0, PAGE_SIZE);
        if (cancelled) return;
        setRows(res.rows);
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

    return () => {
      cancelled = true;
    };
  }, [open, itemCode]);

  // Lazy load หน้าถัดไปด้วย IntersectionObserver
  useEffect(() => {
    if (!open) return;
    if (!hasMore) return;
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
          try {
            const res = await getPurchaseHistory(
              itemCode,
              rows.length,
              PAGE_SIZE
            );
            setRows((prev) => [...prev, ...res.rows]);
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
  }, [open, hasMore, itemCode, rows.length]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex w-full max-w-4xl flex-col rounded-xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
            <History className="h-5 w-5 text-purple-600" />
            ประวัติการซื้อ
            <span className="text-sm font-normal text-gray-500">
              · {itemCode}
              {itemName ? ` — ${itemName}` : ''}
            </span>
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-gray-500 hover:bg-gray-100"
            aria-label="ปิด"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Table body — scrollable */}
        <div className="max-h-[70vh] overflow-y-auto">
          {error && (
            <div className="p-4 text-center text-sm text-red-600">
              เกิดข้อผิดพลาด: {error}
            </div>
          )}

          {rows.length === 0 && !loading && !error && (
            <div className="p-8 text-center text-sm text-gray-500">
              ไม่พบประวัติการซื้อ
            </div>
          )}

          {rows.length > 0 && (
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-gray-50 text-xs uppercase text-gray-600">
                <tr>
                  <th className="px-3 py-2 text-left">เลขที่เอกสาร</th>
                  <th className="px-3 py-2 text-left">วันที่</th>
                  <th className="px-3 py-2 text-left">รหัสผู้จำหน่าย</th>
                  <th className="px-3 py-2 text-right">ราคา</th>
                  <th className="px-3 py-2 text-right">จำนวน</th>
                  <th className="px-3 py-2 text-left">หน่วย</th>
                  <th className="px-3 py-2 text-left">ภาษี</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => (
                  <tr
                    key={`${r.doc_no}-${idx}`}
                    className="border-t hover:bg-purple-50"
                  >
                    <td className="px-3 py-2 font-mono text-xs">{r.doc_no}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {formatDate(r.doc_date)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-mono text-xs">{r.vendor_code}</div>
                      {r.vendor_name && (
                        <div className="text-xs text-gray-500">
                          {r.vendor_name}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatNum(r.price, amountDecimal)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatNum(r.qty, amountDecimal)}
                    </td>
                    <td className="px-3 py-2">{r.unit_code}</td>
                    <td className="px-3 py-2">{vatLabel(r.vat_type)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Loading indicator */}
          {loading && (
            <div className="p-4 text-center text-sm text-gray-500">
              กำลังโหลด...
            </div>
          )}

          {/* Sentinel — observer trigger fetch next page */}
          {hasMore && !loading && (
            <div ref={sentinelRef} className="h-4" aria-hidden="true" />
          )}

          {!hasMore && rows.length > 0 && !loading && (
            <div className="p-3 text-center text-xs text-gray-400">
              — แสดงครบแล้ว ({rows.length} รายการ) —
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
