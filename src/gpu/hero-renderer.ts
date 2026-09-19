import { clock, effect, frameLoop, init, surface } from 'vgpu';
import type { FrameLoopHandle, Surface } from 'vgpu';
import heroShader from './shaders/hero.wgsl';

type HeroRendererOptions = {
  reducedMotion?: boolean;
};

export function startHeroRenderer(canvas: HTMLCanvasElement, options: HeroRendererOptions = {}): () => void {
  let disposed = false;
  let loop: FrameLoopHandle | undefined;
  let gpu: Awaited<ReturnType<typeof init>> | undefined;
  let canvasSurface: Surface | undefined;

  const pointer = { x: 0.5, y: 0.5 };
  const pointerTarget = { x: 0.5, y: 0.5 };
  const pointerVelocity = { x: 0, y: 0 };
  const handlePointerMove = (event: PointerEvent) => {
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) return;
    pointerTarget.x = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
    pointerTarget.y = Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height));
  };

  window.addEventListener('pointermove', handlePointerMove, { passive: true });

  void (async () => {
    if (!('gpu' in navigator)) return;

    try {
      gpu = await init();
      if (disposed) {
        gpu.dispose();
        return;
      }

      canvasSurface = surface(gpu, canvas, { dpr: [1, 1.75], label: 'mangafind-hero' });
      const heroEffect = effect(gpu, heroShader, {
        label: 'mangafind-hero-gradient',
        set: { params: { time: 0, intensity: 0.72, mouse: [0.5, 0.5], texel: canvasSurface.texelSize, mouseVelocity: [0, 0] } },
      });
      const unsubscribeResize = canvasSurface.onResize(() => heroEffect.set({ params: { texel: canvasSurface?.texelSize } }));

      if (options.reducedMotion) {
        heroEffect.set({ params: { time: 0, intensity: 0.52, mouse: [0.5, 0.5], mouseVelocity: [0, 0] } });
        heroEffect.draw(canvasSurface);
        unsubscribeResize();
        return;
      }

      const time = clock(gpu);
      loop = frameLoop(gpu, (frame) => {
        pointer.x += (pointerTarget.x - pointer.x) * 0.12;
        pointer.y += (pointerTarget.y - pointer.y) * 0.12;
        pointerVelocity.x += ((pointerTarget.x - pointer.x) * 0.55 - pointerVelocity.x) * 0.22;
        pointerVelocity.y += ((pointerTarget.y - pointer.y) * 0.55 - pointerVelocity.y) * 0.22;
        pointerVelocity.x *= 0.985;
        pointerVelocity.y *= 0.985;
        const heroProgress = Math.min(1, Math.max(0, window.scrollY / Math.max(window.innerHeight, 1)));
        heroEffect.set({ params: { time: time.time, intensity: 0.92 - heroProgress * 0.2, mouse: [pointer.x, pointer.y], mouseVelocity: [pointerVelocity.x, pointerVelocity.y] } });
        frame.pass(canvasSurface!, heroEffect);
      });

      const originalDispose = gpu.dispose.bind(gpu);
      gpu.dispose = () => {
        unsubscribeResize();
        originalDispose();
      };
    } catch {
      gpu?.dispose();
    }
  })();

  return () => {
    disposed = true;
    window.removeEventListener('pointermove', handlePointerMove);
    loop?.stop();
    canvasSurface?.dispose();
    gpu?.dispose();
  };
}