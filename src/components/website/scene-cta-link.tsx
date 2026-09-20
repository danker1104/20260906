'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { emitSceneEvent } from '../../lib/spline/scene-bus';

// Wraps the CTA link so it can dispatch scene events — page.tsx is a Server
// Component and can't pass event handlers directly to a Link itself.
export function SceneCtaLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  return (
    <Link className={className} href={href} onMouseEnter={() => emitSceneEvent('cta:hover')} onMouseLeave={() => emitSceneEvent('cta:unhover')}>
      {children}
    </Link>
  );
}
