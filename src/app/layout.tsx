import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
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

export const viewport: Viewport = {
  themeColor: '#0a0b0d',
};

const themeInitializationScript = `try{const saved=localStorage.getItem('mangafind-theme');if(saved==='light'||saved==='dark'){document.documentElement.dataset.theme=saved;document.documentElement.style.colorScheme=saved;}}catch{}`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" data-theme="dark" suppressHydrationWarning>
      <body>
        {children}
        <Script id="theme-initialization" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: themeInitializationScript }} />
      </body>
    </html>
  );
}
