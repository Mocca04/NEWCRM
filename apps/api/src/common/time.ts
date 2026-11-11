/** Utilidades de fecha con zona horaria, sin dependencias. Los instantes siempre son Date en UTC. */

const formatters = new Map<string, Intl.DateTimeFormat>();
const formatter = (timeZone: string): Intl.DateTimeFormat => {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    formatters.set(timeZone, f);
  }
  return f;
};

export interface LocalParts {
  /** YYYY-MM-DD en la zona indicada. */
  date: string;
  /** Minutos desde la medianoche local. */
  minutes: number;
  /** 0 = domingo ... 6 = sábado. */
  weekday: number;
}

export function localParts(instant: Date, timeZone: string): LocalParts {
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(instant).map((p) => [p.type, p.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return {
    date,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    weekday: new Date(`${date}T00:00:00Z`).getUTCDay(),
  };
}

/** Instante UTC de una fecha local (YYYY-MM-DD) más unos minutos desde su medianoche. */
export function zonedInstant(date: string, minutes: number, timeZone: string): Date {
  const wall = Date.parse(`${date}T00:00:00Z`) + minutes * 60_000;
  const offsetAt = (guess: number): number => {
    const local = localParts(new Date(guess), timeZone);
    return Date.parse(`${local.date}T00:00:00Z`) + local.minutes * 60_000 - Math.floor(guess / 60_000) * 60_000;
  };
  let utc = wall - offsetAt(wall);
  utc = wall - offsetAt(utc); // segunda pasada: corrige cambios de hora alrededor del instante
  return new Date(utc);
}

export const isDateString = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

export const addMinutes = (instant: Date, minutes: number): Date => new Date(instant.getTime() + minutes * 60_000);
export const overlaps = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean => aStart < bEnd && bStart < aEnd;
