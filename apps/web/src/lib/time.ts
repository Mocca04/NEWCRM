/** Fechas en la zona horaria de la sucursal. Los instantes viajan en ISO (UTC); en pantalla siempre se muestran en hora local del negocio. */

const partsOf = (instant: Date, timeZone: string) => {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(instant).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
};

/** YYYY-MM-DD del instante en la zona indicada. */
export const localDate = (instant: Date | string, timeZone: string): string => partsOf(new Date(instant), timeZone).date;
export const today = (timeZone: string): string => localDate(new Date(), timeZone);

/** Instante UTC de una fecha local más unos minutos desde su medianoche. */
export function zonedInstant(date: string, minutes: number, timeZone: string): Date {
  const wall = Date.parse(`${date}T00:00:00Z`) + minutes * 60_000;
  const offsetAt = (guess: number) => {
    const local = partsOf(new Date(guess), timeZone);
    return Date.parse(`${local.date}T00:00:00Z`) + local.minutes * 60_000 - Math.floor(guess / 60_000) * 60_000;
  };
  return new Date(wall - offsetAt(wall - offsetAt(wall)));
}

export const isDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

export const addDays = (date: string, days: number): string => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
/** 0 = domingo ... 6 = sábado. */
export const weekdayOf = (date: string): number => new Date(`${date}T00:00:00Z`).getUTCDay();
/** Lunes de la semana a la que pertenece la fecha. */
export const mondayOf = (date: string): string => addDays(date, -((weekdayOf(date) + 6) % 7));

export const clock = (instant: string | Date, timeZone: string): string =>
  new Intl.DateTimeFormat('es-CO', { timeZone, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(instant));

/** "lunes 4 de febrero". La fecha ya es local, así que se formatea en UTC para no desplazarla. */
export const longDate = (date: string, withYear = false): string =>
  new Intl.DateTimeFormat('es-CO', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', ...(withYear ? { year: 'numeric' } : {}) }).format(new Date(`${date}T00:00:00Z`));
export const monthName = (date: string): string =>
  new Intl.DateTimeFormat('es-CO', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(`${date}T00:00:00Z`));
