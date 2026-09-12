import { describe, expect, it } from 'vitest';
import { POST } from '../../src/app/api/identify/route';

const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

describe('POST /api/identify boundary', () => {
  it('rejects requests without image files', async () => {
    const response = await POST(new Request('http://localhost/api/identify', { method: 'POST' }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('INVALID_IMAGE');
    expect(body.error.requestId).toMatch(/[0-9a-f-]{36}/);
  });

  it('validates images before attempting the server-side Gemini pipeline', async () => {
    const formData = new FormData();
    formData.append('images', new File([onePixelPng], 'sample.png', { type: 'image/png' }));

    const requestId = '11111111-1111-4111-8111-111111111111';
    const response = await POST(new Request('http://localhost/api/identify', {
      method: 'POST',
      body: formData,
      headers: { 'x-request-id': requestId },
    }));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error.code).toBe('UPSTREAM_UNAVAILABLE');
    expect(body.error.requestId).toBe(requestId);
  });

  it('rejects a file whose declared MIME type disagrees with its magic bytes', async () => {
    const formData = new FormData();
    formData.append('images', new File([onePixelPng], 'sample.jpg', { type: 'image/jpeg' }));

    const response = await POST(new Request('http://localhost/api/identify', {
      method: 'POST',
      body: formData,
    }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('INVALID_IMAGE');
  });
});
