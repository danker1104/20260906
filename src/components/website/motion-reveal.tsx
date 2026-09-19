'use client';

import { useEffect, useRef, type PointerEvent, type ReactNode } from 'react';

type MotionRevealProps = {
  children: ReactNode;
  className?: string;
  variant?: 'rise' | 'slice' | 'drift';
  delay?: number;
};

export function MotionReveal({ children, className = '', variant = 'rise', delay = 0 }: MotionRevealProps) {
  const elementRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    const revealIfVisible = () => {
      const bounds = element.getBoundingClientRect();
      if (bounds.top < window.innerHeight * 0.92 && bounds.bottom > 0) {
        element.classList.add('is-visible');
      }
    };
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) element.classList.add('is-visible');
    }, { threshold: 0.16, rootMargin: '0px 0px -8% 0px' });

    observer.observe(element);
    requestAnimationFrame(revealIfVisible);
    return () => observer.disconnect();
  }, []);

  return <div ref={elementRef} className={`motion-reveal motion-reveal-${variant} ${className}`} style={{ '--motion-delay': `${delay}ms` } as React.CSSProperties}>{children}</div>;
}

export function ParallaxStage({ children }: { children: ReactNode }) {
  const stageRef = useRef<HTMLDivElement>(null);

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width - 0.5) * 2;
    const y = ((event.clientY - bounds.top) / bounds.height - 0.5) * 2;
    stageRef.current?.style.setProperty('--pointer-x', `${x * 8}px`);
    stageRef.current?.style.setProperty('--pointer-y', `${y * 8}px`);
  };

  const resetPointer = () => {
    stageRef.current?.style.setProperty('--pointer-x', '0px');
    stageRef.current?.style.setProperty('--pointer-y', '0px');
  };

  return <div ref={stageRef} className="parallax-stage" onPointerMove={handlePointerMove} onPointerLeave={resetPointer}>{children}</div>;
}