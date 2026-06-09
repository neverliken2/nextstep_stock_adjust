import { createHmac, timingSafeEqual } from 'crypto';

const SESSION_VERSION = 'v1';

function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (secret) return secret;

  if (process.env.NODE_ENV === 'production') {
    throw new Error('SESSION_SECRET is required in production');
  }

  return 'nextstep-cn-dev-session-secret';
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, 'utf-8').toString('base64url');
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf-8');
}

function sign(payload: string): string {
  return createHmac('sha256', getSessionSecret()).update(payload).digest('base64url');
}

export function encodeSession<T>(sessionData: T): string {
  const payload = base64UrlEncode(JSON.stringify(sessionData));
  const signature = sign(payload);
  return `${SESSION_VERSION}.${payload}.${signature}`;
}

export function decodeSession<T>(cookieValue: string): T {
  const [version, payload, signature] = cookieValue.split('.');
  if (version !== SESSION_VERSION || !payload || !signature) {
    throw new Error('Invalid session format');
  }

  const expected = sign(payload);
  const expectedBuffer = Buffer.from(expected, 'base64url');
  const actualBuffer = Buffer.from(signature, 'base64url');

  if (
    expectedBuffer.length !== actualBuffer.length ||
    !timingSafeEqual(expectedBuffer, actualBuffer)
  ) {
    throw new Error('Invalid session signature');
  }

  return JSON.parse(base64UrlDecode(payload)) as T;
}
