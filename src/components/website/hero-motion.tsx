'use client';

import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { animate, createScope, stagger, type Scope } from 'animejs';
import { emitSceneEvent } from '../../lib/spline/scene-bus';

// Drives the hero copy's entrance stagger via anime.js instead of hard-coded CSS delays.
export function HeroMotion({ children }: { children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const scopeRef = useRef<Scope | null>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    root.classList.add('hero-motion-active');
    scopeRef.current = createScope({ root: rootRef }).add(() => {
      // Same timeline as the text stagger below — the Spline orb enters in step with it.
      emitSceneEvent('hero:enter');
      animate('[data-hero-block]', {
        opacity: [0, 1],
        translateY: [22, 0],
        filter: ['blur(6px)', 'blur(0px)'],
        duration: 760,
        ease: 'out(3)',
        delay: stagger(160, { start: 120 }),
      });
      animate('[data-hero-word]', {
        opacity: [0, 1],
        translateY: [24, 0],
        duration: 620,
        ease: 'out(3)',
        delay: stagger(48, { start: 620 }),
      });
    });

    return () => scopeRef.current?.revert();
  }, []);

  return <div ref={rootRef} className="hero-motion">{children}</div>;
}
