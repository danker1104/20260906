'use client';

import { useEffect, useState } from 'react';

type Theme = 'dark' | 'light';

const storageKey = 'mangafind-theme';
const themeColors: Record<Theme, string> = {
  dark: '#0a0b0d',
  light: '#f7f9f8',
};

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColors[theme]);
}

export function ThemeToggle({ className = '' }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>('dark');

  useEffect(() => {
    const currentTheme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
    applyTheme(currentTheme);
    setTheme(currentTheme);
  }, []);

  function toggleTheme() {
    const nextTheme: Theme = theme === 'dark' ? 'light' : 'dark';
    applyTheme(nextTheme);
    setTheme(nextTheme);
    try {
      window.localStorage.setItem(storageKey, nextTheme);
    } catch {
      // The in-memory document theme still works when storage is unavailable.
    }
  }

  const nextLabel = theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환';
  return (
    <button
      className={`theme-toggle ${className}`.trim()}
      type="button"
      aria-label={nextLabel}
      aria-pressed={theme === 'light'}
      title={nextLabel}
      onClick={toggleTheme}
    >
      <svg className="theme-toggle-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {theme === 'dark' ? (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" />
          </>
        ) : (
          <path d="M20.2 15.3A8.5 8.5 0 0 1 8.7 3.8 8.5 8.5 0 1 0 20.2 15.3Z" />
        )}
      </svg>
    </button>
  );
}
