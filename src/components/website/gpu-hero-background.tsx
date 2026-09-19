'use client';

import { useEffect, useRef } from 'react';
import { startHeroRenderer } from '../../gpu/hero-renderer';

export function GpuHeroBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    return startHeroRenderer(canvas, { reducedMotion });
  }, []);

  return <canvas ref={canvasRef} className="gpu-hero-background" aria-hidden="true" />;
}