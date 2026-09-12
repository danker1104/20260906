import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'MangaFind',
  description: '스크린샷으로 일본 만화를 찾아보세요.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
