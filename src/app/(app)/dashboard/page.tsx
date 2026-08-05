import type { Metadata } from 'next';
import { PageHeader } from '@/components/layout/page-header';

export const metadata: Metadata = { title: 'Dashboard · ACME Salary Management' };

export default function DashboardPage() {
  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Payroll cost, headcount and pay health across the organisation."
      />
      <p className="text-sm text-muted-foreground">Coming in a later commit.</p>
    </>
  );
}
