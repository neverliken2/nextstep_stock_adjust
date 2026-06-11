/**
 * Typed HTTP client สำหรับ smlnesservice
 *
 * - ใส่ Authorization Bearer อัตโนมัติ
 * - Parse standard envelope `{success, data, error, ...}` ของ smlnesservice
 * - ถ้า success=false → throw ApiCallError (caller จับ map → user message)
 * - Timeout 30s default
 */

const DEFAULT_TIMEOUT_MS = 30_000;

function getBaseUrl(): string {
  const url = process.env.SMLNES_BASE_URL;
  if (!url) {
    throw new Error('SMLNES_BASE_URL ยังไม่ได้ตั้งใน env');
  }
  return url.replace(/\/+$/, ''); // strip trailing slash
}

interface ApiSuccessEnvelope<T> {
  success: true;
  data: T;
  error: null;
  requestId: string;
  timestamp: string;
}

interface ApiErrorEnvelope {
  success: false;
  data: null;
  error: { code: string; message: string; details?: unknown };
  requestId: string;
  timestamp: string;
}

type ApiEnvelope<T> = ApiSuccessEnvelope<T> | ApiErrorEnvelope;

export class ApiCallError extends Error {
  public readonly code: string;
  public readonly httpStatus: number;
  public readonly details?: unknown;

  constructor(opts: {
    code: string;
    message: string;
    httpStatus: number;
    details?: unknown;
  }) {
    super(opts.message);
    this.name = 'ApiCallError';
    this.code = opts.code;
    this.httpStatus = opts.httpStatus;
    this.details = opts.details;
  }
}

export class ApiTransportError extends Error {
  public readonly cause: unknown;

  constructor(message: string, cause: unknown) {
    super(message);
    this.name = 'ApiTransportError';
    this.cause = cause;
  }
}

export interface RequestOptions {
  method: 'GET' | 'POST';
  path: string;
  /** Bearer token (raw) — ใส่หรือไม่ใส่ก็ได้ (เช่น /health ไม่ต้อง) */
  bearer?: string;
  /** Query params — ตัด undefined/null/empty อัตโนมัติ */
  query?: Record<string, string | number | undefined | null>;
  /** JSON body (POST) */
  body?: unknown;
  /** Override timeout default 30s */
  timeoutMs?: number;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const base = getBaseUrl();
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const url = `${base}${cleanPath}`;

  if (!query) return url;
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    usp.append(k, String(v));
  }
  const qs = usp.toString();
  return qs ? `${url}?${qs}` : url;
}

/**
 * Low-level request — return data ตรงๆ; ถ้า error → throw
 */
export async function apiRequest<T>(opts: RequestOptions): Promise<T> {
  const url = buildUrl(opts.path, opts.query);
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (opts.bearer) headers.Authorization = `Bearer ${opts.bearer}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(url, {
      method: opts.method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      cache: 'no-store',
    });
  } catch (err) {
    throw new ApiTransportError(
      `เชื่อมต่อ smlnesservice ไม่ได้ (${(err as Error).message})`,
      err,
    );
  }

  let envelope: ApiEnvelope<T>;
  try {
    envelope = (await response.json()) as ApiEnvelope<T>;
  } catch (err) {
    throw new ApiTransportError(
      `อ่าน response จาก smlnesservice ไม่สำเร็จ (HTTP ${response.status})`,
      err,
    );
  }

  if (envelope.success) {
    return envelope.data;
  }

  throw new ApiCallError({
    code: envelope.error.code,
    message: envelope.error.message,
    httpStatus: response.status,
    details: envelope.error.details,
  });
}

// ──────────────────────────── Convenience wrappers ────────────────────────────

export function apiGet<T>(
  path: string,
  bearer?: string,
  query?: RequestOptions['query'],
): Promise<T> {
  return apiRequest<T>({ method: 'GET', path, bearer, query });
}

export function apiPost<T>(
  path: string,
  bearer?: string,
  body?: unknown,
): Promise<T> {
  return apiRequest<T>({ method: 'POST', path, bearer, body });
}

// ──────────────────────────── Client token (machine identity) ────────────────────────────

export function getClientToken(): string {
  const token = process.env.SMLNES_CLIENT_TOKEN;
  if (!token) {
    throw new Error('SMLNES_CLIENT_TOKEN ยังไม่ได้ตั้งใน env');
  }
  return token;
}
