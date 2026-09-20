'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import type { Application, SPEObject } from '@splinetool/runtime';
import { onSceneEvent, type SceneEventType } from '../../lib/spline/scene-bus';

// Self-hosted export of the Reactive Orb scene — rendered natively on our own
// canvas via the Spline runtime, not sandboxed in an iframe/video-like view.
const SPLINE_SCENE_PATH = '/spline/reactive-orb.splinecode';

type SceneMode = 'idle' | 'ctaHover' | 'uploadHover' | 'dragging' | 'processing' | 'success';

// Target look for the driven object per app state — multipliers/offsets applied on
// top of the object's own base transform, so this works regardless of how the
// object was authored in the Spline scene.
const MODE_TARGET: Record<SceneMode, { scale: number; spin: number; biasX: number; biasY: number }> = {
  idle: { scale: 1, spin: 1, biasX: 0, biasY: 0 },
  ctaHover: { scale: 1.14, spin: 1.8, biasX: 0, biasY: -0.08 },
  uploadHover: { scale: 1.05, spin: 1.3, biasX: -0.35, biasY: 0.12 },
  dragging: { scale: 1.2, spin: 2.6, biasX: -0.45, biasY: 0.1 },
  processing: { scale: 0.9, spin: 3.4, biasX: 0, biasY: 0 },
  success: { scale: 1.3, spin: 0.5, biasX: 0, biasY: -0.18 },
};

const lerp = (from: number, to: number, factor: number) => from + (to - from) * factor;

// Picks the object this system drives. Never hard-code a guessed name — ask the
// loaded scene what it actually contains and prefer anything orb/sphere-like.
function pickPrimaryObject(app: Application): SPEObject | undefined {
  const objects = app.getAllObjects();
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.info('[spline] scene objects:', objects.map((o) => o.name));
  }
  return objects.find((o) => /orb|sphere|blob|core|main/i.test(o.name)) ?? objects[0];
}
export function SplineHeroScene() {
  const pathname = usePathname();
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
    let rafId = 0;
    let unsubscribeScene = () => {};
    let successRevertTimer: ReturnType<typeof setTimeout> | undefined;
    let removePointerListener: (() => void) | undefined;
    let removeScrollListener: (() => void) | undefined;

    import('@splinetool/runtime').then(({ Application: SplineApplication }) => {
      if (cancelled) return;
      app = new SplineApplication(canvas, { renderMode: 'auto' });
      app
        .load(SPLINE_SCENE_PATH)
        .then(() => {
          if (cancelled || !app) return;
          setIsLoaded(true);

          const target = pickPrimaryObject(app);
          const basePosition = target ? { x: target.position.x, y: target.position.y, z: target.position.z } : undefined;
          const baseScale = target ? { x: target.scale.x, y: target.scale.y, z: target.scale.z } : undefined;

          const pointer = { x: 0, y: 0 };
          const pointerTarget = { x: 0, y: 0 };
          const scroll = { current: 0, target: 0 };
          const anim = { scale: 1, spin: 1, biasX: 0, biasY: 0 };
          let mode: SceneMode = 'idle';
          let rotationAccum = 0;

          // Best-effort hooks into anything authored in the Spline Editor for this mode
          // (a matching State name, or a Mouse Hover / Start event) — no-ops if the
          // artist hasn't wired them up yet, the transform loop below drives it either way.
          const applyMode = (next: SceneMode) => {
            mode = next;
            if (!target) return;
            try {
              target.transition({ to: next });
            } catch {
              /* no matching authored state for this mode */
            }
            try {
              if (next === 'ctaHover' || next === 'uploadHover' || next === 'dragging') {
                app?.emitEvent('mouseHover', target.name);
              }
            } catch {
              /* scene has no mouseHover event on this object */
            }
          };

          unsubscribeScene = onSceneEvent((type: SceneEventType) => {
            if (successRevertTimer) clearTimeout(successRevertTimer);
            switch (type) {
              case 'hero:enter':
                try {
                  if (target) app?.emitEvent('start', target.name);
                } catch {
                  /* no start event authored */
                }
                applyMode('idle');
                break;
              case 'cta:hover':
                applyMode('ctaHover');
                break;
              case 'upload:hover':
                applyMode('uploadHover');
                break;
              case 'upload:drag':
                applyMode('dragging');
                break;
              case 'upload:drop':
                applyMode('dragging');
                successRevertTimer = setTimeout(() => applyMode('idle'), 500);
                break;
              case 'pipeline:start':
                applyMode('processing');
                break;
              case 'pipeline:success':
                applyMode('success');
                successRevertTimer = setTimeout(() => applyMode('idle'), 1800);
                break;
              case 'cta:unhover':
              case 'upload:unhover':
              case 'pipeline:error':
                applyMode('idle');
                break;
              default:
                break;
            }
          });

          const handlePointerMove = (event: PointerEvent) => {
            if (event.pointerType === 'touch') return;
            pointerTarget.x = (event.clientX / window.innerWidth - 0.5) * 2;
            pointerTarget.y = (event.clientY / window.innerHeight - 0.5) * 2;
          };
          const handleScroll = () => {
            scroll.target = Math.min(window.scrollY / (window.innerHeight * 0.8), 1);
          };
          window.addEventListener('pointermove', handlePointerMove, { passive: true });
          window.addEventListener('scroll', handleScroll, { passive: true });
          removePointerListener = () => window.removeEventListener('pointermove', handlePointerMove);
          removeScrollListener = () => window.removeEventListener('scroll', handleScroll);
          handleScroll();

          const container = containerRef.current;
          const tick = () => {
            const sceneTarget = MODE_TARGET[mode];
            anim.scale = lerp(anim.scale, sceneTarget.scale, 0.07);
            anim.spin = lerp(anim.spin, sceneTarget.spin, 0.06);
            anim.biasX = lerp(anim.biasX, sceneTarget.biasX, 0.06);
            anim.biasY = lerp(anim.biasY, sceneTarget.biasY, 0.06);
            // Deliberately slow (lerp, not 1:1) — the space should feel like it's
            // drifting in response to the user, not tracking the cursor directly.
            pointer.x = lerp(pointer.x, pointerTarget.x, 0.04);
            pointer.y = lerp(pointer.y, pointerTarget.y, 0.04);
            scroll.current = lerp(scroll.current, scroll.target, 0.08);
            rotationAccum += 0.006 * anim.spin;

            if (target && basePosition && baseScale) {
              target.position.x = basePosition.x + (pointer.x + anim.biasX) * 90;
              target.position.y = basePosition.y - (pointer.y - anim.biasY) * 70 - scroll.current * 140;
              target.rotation.y = rotationAccum;
              target.scale.x = baseScale.x * anim.scale;
              target.scale.y = baseScale.y * anim.scale;
              target.scale.z = baseScale.z * anim.scale;
            }
            if (container) {
              container.style.setProperty('--scene-x', `${pointer.x * 14}px`);
              container.style.setProperty('--scene-y', `${pointer.y * 10}px`);
              container.style.setProperty('--scene-scroll', `${scroll.current}`);
            }
            rafId = requestAnimationFrame(tick);
          };
          rafId = requestAnimationFrame(tick);
        })
        .catch(() => {});
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      unsubscribeScene();
      removePointerListener?.();
      removeScrollListener?.();
      if (successRevertTimer) clearTimeout(successRevertTimer);
      app?.dispose();
    };
  }, [enabled]);

  // Reduced-motion users get no motion system at all.
  if (!enabled) return null;

  return (
    <div
      ref={containerRef}
      className={`spline-hero-scene${isLoaded ? ' is-loaded' : ''}`}
      data-scene-context={pathname === '/' ? 'home' : 'app'}
      aria-hidden="true"
    >
      <canvas ref={canvasRef} className="spline-hero-frame" />
    </div>
  );
}
