export class ApiClientError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

interface ApiOptions {
  method?: string;
  body?: unknown;
  form?: FormData;
}

export async function api<T = any>(path: string, opts: ApiOptions = {}): Promise<T> {
  const method = opts.method ?? (opts.body !== undefined || opts.form ? 'POST' : 'GET');
  const res = await fetch(path, {
    method,
    headers: {
      'x-csrf': '1',
      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (typeof window !== 'undefined') {
      if (res.status === 401 && window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
      if (data?.code === 'PASSWORD_CHANGE_REQUIRED' && window.location.pathname !== '/change-password') {
        window.location.href = '/change-password';
      }
    }
    throw new ApiClientError(data?.error || 'Request failed.', res.status, data?.code);
  }
  return data as T;
}

export function monthKeyNow(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function prevMonthKey(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * The month the Submissions/Dashboard screens open on for everyone, by
 * default: last month, not the current one - the current month's KPIs are
 * usually still being collected, and landing there by default was how
 * results kept getting entered under the wrong month.
 */
export function defaultMonthKey(): string {
  return prevMonthKey(monthKeyNow());
}

export function fmt(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined) return '—';
  return n.toFixed(digits).replace(/\.?0+$/, '');
}
