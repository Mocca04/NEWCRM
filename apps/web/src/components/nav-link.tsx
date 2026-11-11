'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function NavLink({ href, label, exact = false }: { href: string; label: string; exact?: boolean }) {
  const pathname = usePathname();
  const current = exact ? pathname === href : pathname.startsWith(href);
  return (
    <Link
      href={href}
      aria-current={current ? 'page' : undefined}
      className={`flex min-h-12 flex-1 items-center justify-center rounded-lg px-3 text-sm font-semibold lg:flex-none lg:justify-start lg:px-4 lg:text-base ${
        current ? 'bg-ink text-white' : 'text-ink-soft hover:bg-mirror hover:text-ink'
      }`}
    >
      {label}
    </Link>
  );
}
