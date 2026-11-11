import { ApiError } from './api';

export interface FormState {
  error?: string;
  ok?: string;
}

/** Texto de un campo, sin espacios sobrantes; undefined si viene vacio. */
export const text = (form: FormData, name: string): string | undefined => {
  const value = form.get(name);
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
};

/** Convierte un fallo de la API en un mensaje para el formulario. Deja pasar las redirecciones de Next. */
export function failure(error: unknown): FormState {
  if (error instanceof ApiError) return { error: error.message };
  throw error;
}
