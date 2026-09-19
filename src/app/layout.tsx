import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'MangaFind',
  description: '스크린샷으로 일본 만화를 찾아보세요.',
  metadataBase: new URL('http://localhost:3000'),
  openGraph: {
    title: 'MangaFind | 이 만화, 뭐였지?',
    description: 'SNS에서 발견한 일본 만화를 캡처 한 장으로 찾아보세요.',
    type: 'website',
    locale: 'ko_KR',
  },
  twitter: {
    card: 'summary',
    title: 'MangaFind | 이 만화, 뭐였지?',
    description: 'SNS에서 발견한 일본 만화를 캡처 한 장으로 찾아보세요.',
  },
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
