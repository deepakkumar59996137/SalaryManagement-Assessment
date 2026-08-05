import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Building2 } from 'lucide-react';
import { LoginForm } from '@/components/auth/login-form';
import { DEMO_ACCOUNT, showDemoCredentials } from '@/server/auth/demo-account';
import { currentUser } from '@/server/http/session';

export const metadata: Metadata = { title: 'Sign in · ACME Salary Management' };
export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  if (await currentUser()) redirect('/dashboard');

  const { next } = await searchParams;
  // Only accept a same-site path, so a crafted ?next= cannot bounce someone
  // to another origin after they authenticate.
  const destination = next?.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';

  const demo = showDemoCredentials();

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Building2 className="size-5" aria-hidden />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">ACME Salary Management</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Compensation records and pay analytics
          </p>
        </div>

        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <LoginForm
            next={destination}
            demoEmail={demo ? DEMO_ACCOUNT.email : ''}
            demoPassword={demo ? DEMO_ACCOUNT.password : ''}
          />
        </div>

        {demo && (
          <p className="mt-6 text-center text-xs leading-relaxed text-muted-foreground">
            Demo environment — the form is prefilled with{' '}
            <span className="font-medium text-foreground">{DEMO_ACCOUNT.email}</span>.
            <br />
            All 10,000 employee records are synthetic.
          </p>
        )}
      </div>
    </main>
  );
}
