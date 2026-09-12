import { describe, expect, it } from 'vitest';
import { ImageValidationError } from '../../src/lib/domain/errors';
import { validateAndPrepareImages } from '../../src/lib/validation/image-validation';

const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

describe('image validation', () => {
  it('accepts a real PNG and returns a sanitized buffer', async () => {
    const file = new File([onePixelPng], 'sample.png', { type: 'image/png' });
    const [prepared] = await validateAndPrepareImages([file]);

    expect(prepared.mimeType).toBe('image/png');
    expect(prepared.width).toBe(1);
    expect(prepared.height).toBe(1);
    expect(prepared.buffer.length).toBeGreaterThan(0);
  });

  it('rejects a MIME type that does not match magic bytes', async () => {
    const file = new File([onePixelPng], 'sample.jpg', { type: 'image/jpeg' });

    await expect(validateAndPrepareImages([file])).rejects.toBeInstanceOf(ImageValidationError);
  });

  it('rejects an empty image collection', async () => {
    await expect(validateAndPrepareImages([])).rejects.toBeInstanceOf(ImageValidationError);
  });
});
