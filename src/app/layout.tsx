import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SWiSH KPI Management System',
  description: 'KPI tracking, scoring and reporting for SWiSH',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
