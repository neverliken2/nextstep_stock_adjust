'use client';

import { useEffect, useRef, useState } from 'react';
import { Calendar } from 'lucide-react';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/style.css';

interface Props {
  /** ISO format YYYY-MM-DD (จากหรือไป state ภายนอก) */
  value: string;
  onChange: (iso: string) => void;
  className?: string;
  placeholder?: string;
  /** ถ้า true → input read-only ผ่าน text (user แก้ผ่าน calendar เท่านั้น) */
  disabled?: boolean;
}

/* ───────────────────────── Format helpers ───────────────────────── */

/** ISO YYYY-MM-DD → DD/MM/YYYY (string ว่าง = คืน "") */
function isoToDDMMYYYY(iso: string): string {
  if (!iso || iso.length < 10) return '';
  const y = iso.slice(0, 4);
  const m = iso.slice(5, 7);
  const d = iso.slice(8, 10);
  if (!/^\d{4}$/.test(y) || !/^\d{2}$/.test(m) || !/^\d{2}$/.test(d)) return '';
  return `${d}/${m}/${y}`;
}

/** DD/MM/YYYY → ISO YYYY-MM-DD (return '' ถ้า invalid) */
function ddmmyyyyToIso(text: string): string {
  const t = (text || '').trim();
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return '';
  const dd = m[1].padStart(2, '0');
  const mm = m[2].padStart(2, '0');
  const yyyy = m[3];
  // validate ด้วย Date object — กัน 31/02/2025
  const d = new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
  if (
    isNaN(d.getTime()) ||
    d.getFullYear() !== Number(yyyy) ||
    d.getMonth() + 1 !== Number(mm) ||
    d.getDate() !== Number(dd)
  ) {
    return '';
  }
  return `${yyyy}-${mm}-${dd}`;
}

/** Date object → ISO YYYY-MM-DD (local timezone) */
function dateToIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** ISO YYYY-MM-DD → Date object (return undefined ถ้า invalid) */
function isoToDate(iso: string): Date | undefined {
  if (!iso || iso.length < 10) return undefined;
  const d = new Date(`${iso}T00:00:00`);
  return isNaN(d.getTime()) ? undefined : d;
}

/* ───────────────────────── Component ───────────────────────── */

export default function DateInputDDMMYYYY({
  value,
  onChange,
  className = '',
  placeholder = 'DD/MM/YYYY',
  disabled = false,
}: Props) {
  // text ที่กำลังพิมพ์ (อาจยังไม่ valid)
  const [text, setText] = useState<string>(() => isoToDDMMYYYY(value));
  const [open, setOpen] = useState(false);
  // invalid = พิมพ์เสร็จแล้วยัง parse ไม่ผ่าน → highlight แดง
  const [invalid, setInvalid] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);

  // Sync จาก props.value → text ถ้าค่าภายนอกเปลี่ยน (เช่น load จาก server)
  useEffect(() => {
    const expected = isoToDDMMYYYY(value);
    setText(expected);
    setInvalid(false);
  }, [value]);

  // Click outside → close popup
  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  function handleTextChange(e: React.ChangeEvent<HTMLInputElement>) {
    const t = e.target.value;
    setText(t);
    // ระหว่างพิมพ์ — clear invalid (จะ validate ตอน blur หรือเมื่อยาว 10 ตัว)
    setInvalid(false);
    // Auto-commit เมื่อยาวครบรูปแบบ DD/MM/YYYY (10 char)
    if (t.length === 10) {
      const iso = ddmmyyyyToIso(t);
      if (iso) {
        onChange(iso);
      }
    } else if (t.length === 0) {
      onChange('');
    }
  }

  function handleBlur() {
    if (text.length === 0) {
      onChange('');
      setInvalid(false);
      return;
    }
    const iso = ddmmyyyyToIso(text);
    if (iso) {
      onChange(iso);
      setText(isoToDDMMYYYY(iso));
      setInvalid(false);
    } else {
      setInvalid(true);
    }
  }

  function handlePickDay(d: Date | undefined) {
    if (!d) {
      onChange('');
      setText('');
    } else {
      const iso = dateToIso(d);
      onChange(iso);
      setText(isoToDDMMYYYY(iso));
    }
    setInvalid(false);
    setOpen(false);
  }

  const selectedDate = isoToDate(value);

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-stretch gap-1">
        <input
          type="text"
          inputMode="numeric"
          value={text}
          onChange={handleTextChange}
          onBlur={handleBlur}
          placeholder={placeholder}
          disabled={disabled}
          maxLength={10}
          aria-invalid={invalid || undefined}
          className={`${className} ${
            invalid ? 'border-red-400 focus:border-red-500 focus:ring-red-500' : ''
          } flex-1`}
        />
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen((o) => !o)}
          className="rounded-lg border border-gray-300 px-2 text-gray-600 hover:bg-purple-50 hover:text-purple-600 disabled:opacity-40"
          title="เปิดปฏิทิน"
          aria-label="เปิดปฏิทิน"
        >
          <Calendar className="h-4 w-4" />
        </button>
      </div>

      {open && (
        <div className="absolute left-0 top-full z-40 mt-1 rounded-xl border border-gray-200 bg-white p-2 shadow-xl">
          <DayPicker
            mode="single"
            selected={selectedDate}
            onSelect={handlePickDay}
            showOutsideDays
            captionLayout="dropdown"
          />
        </div>
      )}

      {invalid && (
        <p className="mt-1 text-xs text-red-600">
          รูปแบบไม่ถูกต้อง — ใช้ DD/MM/YYYY (เช่น 11/06/2026)
        </p>
      )}
    </div>
  );
}
