import type { ServerTimeMetadata } from './api';

export const DEFAULT_SERVER_TIME_META: ServerTimeMetadata = {
  server_time: '',
  timezone: 'America/Campo_Grande',
  timezone_label: 'Campo Grande/MS',
  utc_offset: '-04:00',
};

const TICK_MINUTES_BY_RANGE: Record<string, number> = {
  '1h': 10,
  '6h': 30,
  '12h': 60,
  '24h': 120,
  '48h': 240,
  '72h': 360,
};

export function parseUtcTimestamp(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value > 1_000_000_000_000 ? value : value * 1000;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function formatServerDateTime(
  value: unknown,
  meta: ServerTimeMetadata = DEFAULT_SERVER_TIME_META,
  options: Intl.DateTimeFormatOptions = {},
): string {
  const ts = parseUtcTimestamp(value);
  if (!ts) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: meta.timezone || DEFAULT_SERVER_TIME_META.timezone,
    hour12: false,
    ...options,
  }).format(new Date(ts));
}

export function formatServerAxisTime(value: unknown, meta: ServerTimeMetadata): string {
  return formatServerDateTime(value, meta, { hour: '2-digit', minute: '2-digit' });
}

export function formatServerTooltipTime(value: unknown, meta: ServerTimeMetadata): string {
  return formatServerDateTime(value, meta, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function buildServerTimeTicks(rows: Array<{ ts?: number }>, range: string): number[] {
  const points = rows.map(row => Number(row.ts)).filter(ts => Number.isFinite(ts) && ts > 0).sort((a, b) => a - b);
  if (points.length === 0) return [];

  const first = points[0];
  const last = points[points.length - 1];
  const stepMs = (TICK_MINUTES_BY_RANGE[range] ?? 60) * 60 * 1000;
  const ticks: number[] = [];

  if (first === last) return [first];

  let cursor = Math.ceil(first / stepMs) * stepMs;
  while (cursor <= last) {
    ticks.push(cursor);
    cursor += stepMs;
  }

  if (ticks.length < 2) return [first, last];
  return ticks;
}

export function timezoneBadgeText(meta: ServerTimeMetadata): string {
  return `Timezone: ${meta.timezone_label || DEFAULT_SERVER_TIME_META.timezone_label} · ${meta.utc_offset || DEFAULT_SERVER_TIME_META.utc_offset}`;
}