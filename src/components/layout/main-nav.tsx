'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const SECTIONS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/employees', label: 'Employees' },
  { href: '/analytics', label: 'Analytics' },
  { href: '/data', label: 'Import & export' },
  { href: '/audit', label: 'Audit log' },
] as const;

export function MainNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Main" className="flex items-center gap-1 overflow-x-auto">
      {SECTIONS.map((section) => {
        const active = pathname === section.href || pathname.startsWith(`${section.href}/`);

        return (
          <Link
            key={section.href}
            href={section.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors',
              active
                ? 'bg-secondary text-secondary-foreground'
                : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
            )}
          >
            {section.label}
          </Link>
        );
      })}
    </nav>
  );
}
