'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function NavLink({
  href,
  label,
  exact = false,
  desktopOnly = false,
  alsoCurrentOnMobile = [],
}: {
  href: string;
  label: string;
  exact?: boolean;
  /** Solo en el menú lateral de computador. */
  desktopOnly?: boolean;
  /** Secciones que en celular viven dentro de esta. */
  alsoCurrentOnMobile?: string[];
}) {
  const pathname = usePathname();
  const current = exact ? pathname === href : pathname.startsWith(href);
  const nested = alsoCurrentOnMobile.some((path) => pathname.startsWith(path));
  const on = 'bg-ink text-white';
  const off = 'text-ink-soft hover:bg-mirror hover:text-ink';
  return (
    <Link
      href={href}
      aria-current={current ? 'page' : undefined}
      className={`min-h-12 flex-1 items-center justify-center rounded-lg px-2 text-sm font-semibold lg:flex-none lg:justify-start lg:px-4 lg:text-base ${
        desktopOnly ? 'hidden lg:flex' : 'flex'
      } ${current ? on : nested ? `${on} lg:bg-transparent lg:text-ink-soft` : off}`}
    >
      {label}
    </Link>
  );
}
