'use client';

import { useEffect, useState, useTransition } from 'react';
import { X, Search } from 'lucide-react';

export interface LookupOption {
  code: string;
  name: string;
}

interface Props {
  open: boolean;
  title: string;
  /** ดึงรายการตาม query (server action) */
  searchFn: (query: string) => Promise<LookupOption[]>;
  /** message โชว์เหนือ table (เช่น "กรองเฉพาะคลัง MMA01") */
  hint?: string;
  onClose: () => void;
  onSelect: (option: LookupOption) => void;
}

export default function LookupPickerModal({
  open,
  title,
  searchFn,
  hint,
  onClose,
  onSelect,
}: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<LookupOption[]>([]);
  const [isPending, startTransition] = useTransition();
  const [loaded, setLoaded] = useState(false);

  // โหลด default list ครั้งเดียวตอน mount
  useEffect(() => {
    startTransition(async () => {
      const r = await searchFn('');
      setResults(r);
      setLoaded(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doSearch = (q: string) => {
    setQuery(q);
    startTransition(async () => {
      const r = await searchFn(q);
      setResults(r);
    });
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-gray-500 hover:bg-gray-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="border-b p-4">
          {hint && (
            <div className="mb-2 text-xs text-gray-500">{hint}</div>
          )}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              autoFocus
              value={query}
              onChange={(e) => doSearch(e.target.value)}
              placeholder="พิมพ์รหัสหรือชื่อ..."
              className="w-full rounded-lg border border-gray-300 py-2 pl-10 pr-3 text-sm focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
            />
          </div>
        </div>

        <div className="max-h-96 overflow-y-auto">
          {isPending && !loaded && (
            <div className="p-6 text-center text-sm text-gray-500">กำลังโหลด...</div>
          )}
          {!isPending && results.length === 0 && (
            <div className="p-6 text-center text-sm text-gray-500">ไม่พบข้อมูล</div>
          )}
          {results.length > 0 && (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 text-xs text-gray-600">
                <tr>
                  <th className="px-3 py-2 text-left">รหัส</th>
                  <th className="px-3 py-2 text-left">ชื่อ</th>
                </tr>
              </thead>
              <tbody>
                {results.map((opt) => (
                  <tr
                    key={opt.code}
                    className="cursor-pointer border-t hover:bg-purple-50"
                    onClick={() => {
                      onSelect(opt);
                      onClose();
                    }}
                  >
                    <td className="px-3 py-2 font-mono text-xs">{opt.code}</td>
                    <td className="px-3 py-2">{opt.name}</td>
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
