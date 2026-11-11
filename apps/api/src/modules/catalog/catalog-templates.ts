import { ServiceVertical } from '@newcrm/database';

/**
 * Catálogo inicial por tipo de negocio. Las duraciones son sugerencias para
 * empezar; los precios quedan en 0 y los servicios sin publicar hasta que el
 * negocio los revise.
 */
export const CATALOG_TEMPLATES: Record<Exclude<ServiceVertical, 'OTHER'>, { category: string; services: [name: string, minutes: number][] }> = {
  MANICURE: {
    category: 'Manicure',
    services: [['Manicure tradicional', 45], ['Semipermanente', 60], ['Acrílicas', 120], ['Polygel', 120], ['Pedicure', 60], ['Retiro', 30], ['Decoración', 20]],
  },
  BARBERSHOP: {
    category: 'Barbería',
    services: [['Corte', 30], ['Degradado', 40], ['Barba', 20], ['Corte y barba', 50], ['Cejas', 10], ['Tratamientos', 30]],
  },
  HAIR_SALON: {
    category: 'Peluquería',
    services: [['Corte', 45], ['Cepillado', 45], ['Tintura', 120], ['Mechas', 180], ['Balayage', 240], ['Keratina', 180], ['Tratamientos capilares', 60]],
  },
};
