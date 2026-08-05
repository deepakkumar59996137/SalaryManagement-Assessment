import Link from 'next/link';
import { Building2 } from 'lucide-react';
import { MainNav } from '@/components/layout/main-nav';
import { UserMenu } from '@/components/layout/user-menu';
import { requireUserOrRedirect } from '@/server/http/session';

/**
 * Every page under (app) is behind this layout, so the auth check happens once
 * rather than being repeated — and forgotten — in each page.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUserOrRedirect();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/75">
        <div className="mx-auto flex h-14 w-full max-w-[1400px] items-center gap-6 px-4 sm:px-6">
          <Link href="/dashboard" className="flex shrink-0 items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Building2 className="size-4" aria-hidden />
            </span>
            <span className="hidden text-sm font-semibold tracking-tight sm:inline">
              ACME Salary
            </span>
          </Link>

          <MainNav />

          <div className="ml-auto shrink-0">
            <UserMenu name={user.name} email={user.email} />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
