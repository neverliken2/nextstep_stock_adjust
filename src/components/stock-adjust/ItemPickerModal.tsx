'use client';

import { useState, useTransition } from 'react';
import { X, Search } from 'lucide-react';
import { searchItems, type ItemOption } from '@/actions/stock-adjust';

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (item: ItemOption) => void;
}

export default function ItemPickerModal({ open, onClose, onSelect }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ItemOption[]>([]);
  const [isPending, startTransition] = useTransition();
  const [hasSearched, setHasSearched] = useState(false);

  const doSearch = (q: string) => {
    setQuery(q);
    setHasSearched(true);
    startTransition(async () => {
      const r = await searchItems(q);
      setResults(r);
    });
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-3xl rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-lg font-semibold text-gray-900">ค้นหาสินค้า</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-gray-500 hover:bg-gray-100"
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
              onChange={(e) => doSearch(e.target.value)}
              placeholder="พิมพ์รหัสหรือชื่อสินค้า..."
              className="w-full rounded-lg border border-gray-300 py-2 pl-10 pr-3 text-sm focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
            />
          </div>
        </div>

        <div className="max-h-96 overflow-y-auto">
          {isPending && (
            <div className="p-6 text-center text-sm text-gray-500">กำลังค้นหา...</div>
          )}
          {!isPending && !hasSearched && (
            <div className="p-6 text-center text-sm text-gray-400">
              พิมพ์รหัสหรือชื่อสินค้าเพื่อค้นหา
            </div>
          )}
          {!isPending && hasSearched && results.length === 0 && (
            <div className="p-6 text-center text-sm text-gray-500">ไม่พบสินค้า</div>
          )}
          {!isPending && results.length > 0 && (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 text-xs text-gray-600">
                <tr>
                  <th className="px-3 py-2 text-left">รหัส</th>
                  <th className="px-3 py-2 text-left">ชื่อสินค้า</th>
                  <th className="px-3 py-2 text-left">หน่วย</th>
                  <th className="px-3 py-2 text-right">ทุนเฉลี่ย</th>
                </tr>
              </thead>
              <tbody>
                {results.map((it) => (
                  <tr
                    key={it.code}
                    className="cursor-pointer border-t hover:bg-purple-50"
                    onClick={() => {
                      onSelect(it);
                      onClose();
                    }}
                  >
                    <td className="px-3 py-2 font-mono text-xs">{it.code}</td>
                    <td className="px-3 py-2">{it.name}</td>
                    <td className="px-3 py-2 text-gray-600">{it.unit_standard}</td>
                    <td className="px-3 py-2 text-right text-gray-700">
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
        </div>
      </div>
    </div>
  );
}
