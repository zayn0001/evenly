import type { Metadata, Viewport } from 'next';
import { Courier_Prime, Special_Elite } from 'next/font/google';

import { AuthProvider } from '@/components/auth';

import './globals.css';

const body = Courier_Prime({ weight: ['400', '700'], style: ['normal', 'italic'], subsets: ['latin'], variable: '--font-body' });
const title = Special_Elite({ weight: '400', subsets: ['latin'], variable: '--font-title' });

export const metadata: Metadata = {
  title: 'Evenly',
  description: 'Snap the bill, say who had what, and see what everyone owes.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover', // lets the action bar sit above the iPhone home indicator
  themeColor: '#36454d',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-IN" className={`${body.variable} ${title.variable}`}>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
