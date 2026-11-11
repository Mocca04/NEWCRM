'use server';

import { redirect } from 'next/navigation';
import { text, type FormState } from '@/lib/form';
import { createClient } from '@/lib/supabase/server';

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '');

export async function signIn(_: FormState, form: FormData): Promise<FormState> {
  const email = text(form, 'email');
  const password = form.get('password');
  if (!email || typeof password !== 'string' || !password) return { error: 'Escribe tu correo y tu contraseña.' };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    if (error.code === 'email_not_confirmed') return { error: 'Confirma tu correo antes de entrar: te enviamos un enlace al registrarte.' };
    if (error.code === 'invalid_credentials' || error.status === 400) return { error: 'El correo o la contraseña no coinciden.' };
    return { error: 'No pudimos iniciar la sesión. Intenta de nuevo en un momento.' };
  }
  redirect('/panel');
}

export async function signUp(_: FormState, form: FormData): Promise<FormState> {
  const fullName = text(form, 'fullName');
  const email = text(form, 'email');
  const password = form.get('password');
  if (!fullName || !email) return { error: 'Escribe tu nombre y tu correo.' };
  if (typeof password !== 'string' || password.length < 8) return { error: 'La contraseña debe tener al menos 8 caracteres.' };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName }, emailRedirectTo: `${SITE_URL}/auth/confirm` },
  });
  if (error) {
    if (error.code === 'user_already_exists') return { error: 'Ya hay una cuenta con ese correo. Inicia sesión.' };
    if (error.code === 'weak_password') return { error: 'Esa contraseña es muy fácil de adivinar. Prueba una más larga.' };
    return { error: 'No pudimos crear la cuenta. Intenta de nuevo en un momento.' };
  }
  if (data.session) redirect('/panel');
  return { ok: `Te enviamos un enlace a ${email}. Ábrelo para confirmar tu correo y entrar.` };
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
