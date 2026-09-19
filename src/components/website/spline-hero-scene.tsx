'use client';

import { useEffect, useRef, useState } from 'react';
import type { Application } from '@splinetool/runtime';

// Self-hosted export of the Reactive Orb scene — rendered natively on our own
// canvas via the Spline runtime, not sandboxed in an iframe/video-like view.
const SPLINE_SCENE_PATH = '/spline/reactive-orb.splinecode';

export function SplineHeroScene() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    setEnabled(!window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    let app: Application | undefined;
    let cancelled = false;

    import('@splinetool/runtime').then(({ Application: SplineApplication }) => {
      if (cancelled) return;
      app = new SplineApplication(canvas, { renderMode: 'auto' });
      app
        .load(SPLINE_SCENE_PATH)
        .then(() => {
          if (!cancelled) setIsLoaded(true);
        })
        .catch(() => {});
    });

    return () => {
      cancelled = true;
      app?.dispose();
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const container = containerRef.current;
    if (!container) return;

    let frame = 0;
    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      const x = (event.clientX / window.innerWidth - 0.5) * 2;
      const y = (event.clientY / window.innerHeight - 0.5) * 2;
      container.style.setProperty('--scene-x', `${x * 14}px`);
      container.style.setProperty('--scene-y', `${y * 10}px`);
    };
    const handleScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const progress = Math.min(window.scrollY / (window.innerHeight * 0.8), 1);
        container.style.setProperty('--scene-scroll', `${progress}`);
      });
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('scroll', handleScroll);
      cancelAnimationFrame(frame);
    };
  }, [enabled]);

  // Reduced-motion users stay on the static GPU background only.
  if (!enabled) return null;

  return (
    <div ref={containerRef} className={`spline-hero-scene${isLoaded ? ' is-loaded' : ''}`} aria-hidden="true">
      <canvas ref={canvasRef} className="spline-hero-frame" />
    </div>
  );
}
