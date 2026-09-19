'use client';

import { useEffect, useRef, useState } from 'react';

export function HeroVideoBackground() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const desktopQuery = window.matchMedia('(min-width: 768px)');
    setIsDesktop(desktopQuery.matches);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !isDesktop) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const syncMotionPreference = () => {
      if (reducedMotion.matches) {
        video.pause();
        video.currentTime = 0;
      } else {
        void video.play().catch(() => undefined);
      }
    };

    syncMotionPreference();
    reducedMotion.addEventListener('change', syncMotionPreference);
    return () => reducedMotion.removeEventListener('change', syncMotionPreference);
  }, []);

  if (!isDesktop) return null;

  return (
    <video ref={videoRef} className="hero-video-background" autoPlay loop muted playsInline preload="auto" aria-hidden="true">
      <source src="/homepage-motion.mp4" type="video/mp4" />
    </video>
  );
}