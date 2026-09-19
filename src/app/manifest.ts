import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'MangaFind',
    short_name: 'MangaFind',
    description: '스크린샷으로 일본 만화를 찾아보세요.',
    start_url: '/search',
    display: 'standalone',
    background_color: '#0a0b0d',
    theme_color: '#0a0b0d',
    lang: 'ko',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
  };
}
