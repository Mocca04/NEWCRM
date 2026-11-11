import { localParts, zonedInstant } from '../src/common/time';

describe('fechas con zona horaria', () => {
  it('convierte hora local de Bogotá a UTC y de vuelta', () => {
    expect(zonedInstant('2030-02-04', 600, 'America/Bogota').toISOString()).toBe('2030-02-04T15:00:00.000Z');
    expect(localParts(new Date('2030-02-04T15:00:00Z'), 'America/Bogota')).toEqual({ date: '2030-02-04', minutes: 600, weekday: 1 });
    // Cerca de la medianoche el día local no es el día UTC.
    expect(localParts(new Date('2030-02-05T02:30:00Z'), 'America/Bogota')).toEqual({ date: '2030-02-04', minutes: 1290, weekday: 1 });
  });

  it('respeta el horario de verano en zonas que lo tienen', () => {
    expect(zonedInstant('2030-07-01', 540, 'Europe/Madrid').toISOString()).toBe('2030-07-01T07:00:00.000Z');
    expect(zonedInstant('2030-01-15', 540, 'Europe/Madrid').toISOString()).toBe('2030-01-15T08:00:00.000Z');
    expect(zonedInstant('2030-03-11', 540, 'America/New_York').toISOString()).toBe('2030-03-11T13:00:00.000Z');
    expect(zonedInstant('2030-03-09', 540, 'America/New_York').toISOString()).toBe('2030-03-09T14:00:00.000Z');
  });
});
