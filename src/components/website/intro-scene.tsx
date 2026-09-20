'use client';

import { useEffect, useRef, useState } from 'react';

// A wheel-gated intro: the mouse wheel (or a touch drag) zooms into a dense
// particle sphere. Body scroll stays locked until the zoom completes, at which
// point the overlay is dropped and the real homepage takes over.
const PARTICLE_COUNT = 1400;
const STAR_COUNT = 70;
const STREAK_COUNT = 10;
const CROSS_COUNT = 9;
const ZOOM_PER_WHEEL_PX = 1 / 380;

type Particle = { x: number; y: number; z: number };
type Star = { x: number; y: number; r: number; a: number };
type Streak = { x: number; y: number; length: number; angle: number; a: number };
type Cross = { x: number; y: number; size: number; a: number };
type ScreenPoint = { sx: number; sy: number } | null;

const lerp = (from: number, to: number, factor: number) => from + (to - from) * factor;
const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
};

function buildSphere(count: number): Particle[] {
  const points: Particle[] = [];
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2;
    const radiusAtY = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = goldenAngle * i;
    // Slight radius jitter per point so the shell reads as a dense granular ball
    // rather than a perfectly even wireframe surface.
    const jitter = 0.94 + Math.sin(i * 12.9898) * 0.5 * 0.06 + 0.06;
    points.push({ x: Math.cos(theta) * radiusAtY * jitter, y: y * jitter, z: Math.sin(theta) * radiusAtY * jitter });
  }
  return points;
}

function buildScatter(width: number, height: number) {
  const stars: Star[] = Array.from({ length: STAR_COUNT }, () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    r: Math.random() * 1.6 + 0.4,
    a: Math.random() * 0.5 + 0.15,
  }));
  const streaks: Streak[] = Array.from({ length: STREAK_COUNT }, () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    length: Math.random() * 90 + 40,
    angle: (Math.random() - 0.5) * 0.5,
    a: Math.random() * 0.14 + 0.04,
  }));
  const crosses: Cross[] = Array.from({ length: CROSS_COUNT }, () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    size: Math.random() * 4 + 4,
    a: Math.random() * 0.3 + 0.15,
  }));
  return { stars, streaks, crosses };
}

export function IntroScene() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [enabled, setEnabled] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    setEnabled(!window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }, []);

  useEffect(() => {
    if (!enabled || done) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const html = document.documentElement;
    const previousOverflow = html.style.overflow;
    html.style.overflow = 'hidden';
    window.scrollTo(0, 0);

    const particleCount = window.innerWidth < 768 ? Math.round(PARTICLE_COUNT * 0.5) : Math.round(PARTICLE_COUNT * 0.85);
    const points = buildSphere(particleCount);
    const prevScreen: ScreenPoint[] = new Array(particleCount).fill(null);
    const pointer = { x: 0, y: 0 };
    const pointerTarget = { x: 0, y: 0 };
    let scatter = buildScatter(1, 1);
    let rotation = 0;
    let zoomTarget = 0;
    let zoom = 0;
    let rafId = 0;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let touchStartY = 0;
    let finished = false;

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      scatter = buildScatter(width, height);
    };

    const finish = () => {
      if (finished) return;
      finished = true;
      html.style.overflow = previousOverflow;
      setDone(true);
    };

    const advanceZoom = (deltaPx: number) => {
      zoomTarget = Math.min(Math.max(zoomTarget + deltaPx * ZOOM_PER_WHEEL_PX, 0), 1);
    };

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      advanceZoom(event.deltaY);
    };
    const handleTouchStart = (event: TouchEvent) => {
      touchStartY = event.touches[0]?.clientY ?? 0;
    };
    const handleTouchMove = (event: TouchEvent) => {
      event.preventDefault();
      const y = event.touches[0]?.clientY ?? touchStartY;
      advanceZoom((touchStartY - y) * 2.2);
      touchStartY = y;
    };
    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      pointerTarget.x = (event.clientX / window.innerWidth - 0.5) * 2;
      pointerTarget.y = (event.clientY / window.innerHeight - 0.5) * 2;
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowDown' || event.key === 'PageDown' || event.key === ' ') advanceZoom(220);
      if (event.key === 'ArrowUp' || event.key === 'PageUp') advanceZoom(-220);
    };
    const handleVisibilityChange = () => {
      if (document.hidden) {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = 0;
      } else if (!finished) {
        rafId = requestAnimationFrame(draw);
      }
    };

    const draw = () => {
      pointer.x = lerp(pointer.x, pointerTarget.x, 0.05);
      pointer.y = lerp(pointer.y, pointerTarget.y, 0.05);
      zoom = lerp(zoom, zoomTarget, 0.12);
      rotation += 0.003 + zoom * 0.05;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.scale(dpr, dpr);

      const cx = width / 2;
      const cy = height / 2;
      const scatterFade = Math.max(0, 1 - zoom * 1.25);

      if (scatterFade > 0.01) {
        ctx.globalAlpha = scatterFade;
        for (const streak of scatter.streaks) {
          ctx.save();
          ctx.translate(streak.x, streak.y);
          ctx.rotate(streak.angle);
          ctx.strokeStyle = `rgba(147, 197, 253, ${streak.a.toFixed(3)})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(-streak.length / 2, 0);
          ctx.lineTo(streak.length / 2, 0);
          ctx.stroke();
          ctx.restore();
        }
        for (const star of scatter.stars) {
          ctx.beginPath();
          ctx.fillStyle = `rgba(214, 228, 255, ${star.a.toFixed(3)})`;
          ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
          ctx.fill();
        }
        for (const cross of scatter.crosses) {
          ctx.strokeStyle = `rgba(147, 197, 253, ${cross.a.toFixed(3)})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(cross.x - cross.size, cross.y);
          ctx.lineTo(cross.x + cross.size, cross.y);
          ctx.moveTo(cross.x, cross.y - cross.size);
          ctx.lineTo(cross.x, cross.y + cross.size);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }

      const idlePulse = Math.sin(performance.now() * 0.00115) * 0.018;
      const baseRadius = Math.min(width, height) * 0.195;
      // The sphere stays recognisably itself — same rough size as the resting
      // scene — almost the whole way through, and only truly balloons to fill
      // the frame in the last stretch, right where the flash/cover kicks in.
      const zoomEase = zoom * zoom * (3 - 2 * zoom);
      const finalSurge = Math.pow(zoom, 14) * 5;
      const sphereRadius = baseRadius * (1 + idlePulse + zoomEase * 0.35 + finalSurge);
      const focal = sphereRadius * 3.2;
      const tiltX = pointer.y * 0.35;
      const tiltY = rotation + pointer.x * 0.35;
      const cosY = Math.cos(tiltY);
      const sinY = Math.sin(tiltY);
      const cosX = Math.cos(tiltX);
      const sinX = Math.sin(tiltX);

      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, baseRadius * 1.7);
      glow.addColorStop(0, `rgba(110, 150, 240, ${(0.22 + zoom * 0.14).toFixed(3)})`);
      glow.addColorStop(1, 'rgba(110, 150, 240, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(cx - baseRadius * 1.8, cy - baseRadius * 1.8, baseRadius * 3.6, baseRadius * 3.6);

      // Fine horizontal orbit lines give the idle sphere the same instrument-like
      // scan depth as the reference motion, without competing with the particles.
      for (let i = -2; i <= 2; i++) {
        const lineScale = Math.sqrt(Math.max(0.12, 1 - (i / 3.2) ** 2));
        const lineY = cy + i * sphereRadius * 0.22;
        ctx.strokeStyle = `rgba(150, 184, 245, ${(0.06 + lineScale * 0.045).toFixed(3)})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(cx, lineY, sphereRadius * lineScale, sphereRadius * 0.12, 0, 0, Math.PI * 2);
        ctx.stroke();
      }

      // A couple of pulse rings that are already faintly present at rest and keep
      // re-triggering as the zoom progresses, so the idle and zoomed scenes read
      // as one continuous animation rather than two different looks.
      for (let i = 0; i < 2; i++) {
        const ringProgress = (zoom * 2.1 + i * 0.5) % 1;
        const ringRadius = sphereRadius * (0.55 + ringProgress * 0.9);
        const ringAlpha = (1 - ringProgress) * 0.5 * Math.min(1, 0.14 + zoom * 3.6);
        if (ringAlpha <= 0.01) continue;
        ctx.strokeStyle = `rgba(150, 210, 255, ${ringAlpha.toFixed(3)})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cx, cy, ringRadius, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Colour already carries a touch of the violet-cyan it warms into, so the
      // shift with zoom feels like an intensification, not a colour swap.
      const colorR = Math.round(lerp(214, 188, zoom));
      const colorG = Math.round(lerp(224, 162, zoom));
      const colorB = 255;
      const trailBoost = Math.min(1, 0.08 + zoom * 2.3);
      const brightnessBoost = 1 + zoom * 0.5;

      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        const x1 = p.x * cosY - p.z * sinY;
        const z1 = p.x * sinY + p.z * cosY;
        const y1 = p.y * cosX - z1 * sinX;
        const z2 = p.y * sinX + z1 * cosX;
        const scale = focal / (focal + z2 * sphereRadius);
        const sx = cx + x1 * sphereRadius * scale;
        const sy = cy + y1 * sphereRadius * scale;
        const depthFactor = (z2 + 1) / 2;
        const size = Math.max(0.5, scale * (1.6 + zoomEase * 1.4));
        const alpha = Math.min(1, (0.17 + depthFactor * 0.62) * brightnessBoost);

        const prev = prevScreen[i];
        if (prev && trailBoost > 0.02) {
          const trailAlpha = alpha * trailBoost * 0.8;
          ctx.strokeStyle = `rgba(${colorR}, ${colorG}, ${colorB}, ${trailAlpha.toFixed(3)})`;
          ctx.lineWidth = Math.max(0.6, size * 0.7);
          ctx.beginPath();
          ctx.moveTo(prev.sx, prev.sy);
          ctx.lineTo(sx, sy);
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.fillStyle = `rgba(${colorR}, ${colorG}, ${colorB}, ${alpha.toFixed(3)})`;
        ctx.arc(sx, sy, size, 0, Math.PI * 2);
        ctx.fill();

        prevScreen[i] = { sx, sy };
      }

      // A bright bloom right before the flight completes, then a solid cover so the
      // handoff to the real homepage never pops.
      const flash = smoothstep(0.86, 0.97, zoom);
      if (flash > 0) {
        const flashGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(width, height) * 0.7);
        flashGlow.addColorStop(0, `rgba(255, 255, 255, ${(flash * 0.85).toFixed(3)})`);
        flashGlow.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = flashGlow;
        ctx.fillRect(0, 0, width, height);
      }
      const cover = smoothstep(0.95, 1, zoom);
      if (cover > 0) {
        ctx.fillStyle = `rgba(5, 7, 12, ${cover.toFixed(3)})`;
        ctx.fillRect(0, 0, width, height);
      }
      ctx.restore();

      if (zoom >= 0.999 && zoomTarget >= 0.999) {
        finish();
        return;
      }
      rafId = requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    window.addEventListener('wheel', handleWheel, { passive: false });
    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    rafId = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('wheel', handleWheel);
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (!finished) html.style.overflow = previousOverflow;
    };
  }, [enabled, done]);

  if (!enabled || done) return null;

  return (
    <div className="intro-scene" role="region" aria-label="휠을 돌려 확대해 홈페이지로 진입하는 소개 화면">
      <canvas className="intro-canvas" ref={canvasRef} />
      <p className="intro-hint">스크롤하거나 위로 쓸어넘겨 홈페이지로 들어가세요</p>
      <button type="button" className="intro-skip" onClick={() => setDone(true)}>
        건너뛰기
      </button>
    </div>
  );
}

