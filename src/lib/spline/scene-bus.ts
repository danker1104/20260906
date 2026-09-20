'use client';

// Decoupled pub/sub so any UI (hero copy, CTA, uploader, search page) can tell the
// persistent Spline scene what the app is doing, without importing the Spline runtime.
export type SceneEventType =
  | 'hero:enter'
  | 'cta:hover'
  | 'cta:unhover'
  | 'upload:hover'
  | 'upload:unhover'
  | 'upload:drag'
  | 'upload:drop'
  | 'pipeline:start'
  | 'pipeline:success'
  | 'pipeline:error';

const CHANNEL = 'mangafind:scene-event';

export function emitSceneEvent(type: SceneEventType): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<SceneEventType>(CHANNEL, { detail: type }));
}

export function onSceneEvent(handler: (type: SceneEventType) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const listener = (event: Event) => handler((event as CustomEvent<SceneEventType>).detail);
  window.addEventListener(CHANNEL, listener);
  return () => window.removeEventListener(CHANNEL, listener);
}
