import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants';

export default function nextConfig(phase: string): NextConfig {
  return {
    output: 'standalone',
    distDir: phase === PHASE_DEVELOPMENT_SERVER ? '.next-dev' : '.next',
    turbopack: {
      rules: {
        '*.wgsl': {
          loaders: ['@vgpu/wgsl/loader-webpack'],
          as: '*.js',
        },
      },
    },
    webpack(config) {
      config.module.rules.push({
        test: /\.wgsl$/,
        loader: '@vgpu/wgsl/loader-webpack',
        options: { minify: true },
      });
      return config;
    },
  };
}
