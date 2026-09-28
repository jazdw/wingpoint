export function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Convert an epoch timestamp to a yyyy-mm-dd value for <input type="date">. */
export function toDateInput(ms: number): string {
  const date = new Date(ms);
  const local = new Date(ms - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

/** Convert a yyyy-mm-dd input value back to a local-noon epoch timestamp. */
export function fromDateInput(value: string): number {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return Date.now();
  return new Date(year, month - 1, day, 12, 0, 0).getTime();
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
