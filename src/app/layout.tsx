import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ACME Salary Management',
  description: 'Compensation management and pay analytics for ACME Corp',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
