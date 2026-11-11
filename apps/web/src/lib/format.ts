const cop = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });

/** La API maneja el dinero en centavos de COP; en pantalla se muestra y se escribe en pesos. */
export const pesos = (cents: number): string => cop.format(cents / 100);
export const toCents = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const amount = Number(value.replace(/[.\s$]/g, '').replace(',', '.'));
  return Number.isFinite(amount) ? Math.round(amount * 100) : Number.NaN;
};

export const duration = (minutes: number): string => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
};

/** Días en el orden en que se lee una semana de trabajo. El número es el que usa la API (0 = domingo). */
export const WEEK: ReadonlyArray<{ weekday: number; name: string; short: string }> = [
  { weekday: 1, name: 'Lunes', short: 'Lun' },
  { weekday: 2, name: 'Martes', short: 'Mar' },
  { weekday: 3, name: 'Miércoles', short: 'Mié' },
  { weekday: 4, name: 'Jueves', short: 'Jue' },
  { weekday: 5, name: 'Viernes', short: 'Vie' },
  { weekday: 6, name: 'Sábado', short: 'Sáb' },
  { weekday: 0, name: 'Domingo', short: 'Dom' },
];
