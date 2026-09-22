import sharp from 'sharp';
import type { PreparedImage, SupportedImageMimeType } from '../domain/types';
import { ImageValidationError } from '../domain/errors';

const MAX_IMAGES = 3;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 8192;
const MAX_IMAGE_PIXELS = 64 * 1000 * 1000;

const mimeByMagic: Array<{
  mimeType: SupportedImageMimeType;
  matches: (buffer: Buffer) => boolean;
}> = [
  {
    mimeType: 'image/jpeg',
    matches: (buffer) => buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff,
  },
  {
    mimeType: 'image/png',
    matches: (buffer) => buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    mimeType: 'image/webp',
    matches: (buffer) => buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP',
  },
];

function detectMimeType(buffer: Buffer): SupportedImageMimeType | undefined {
  return mimeByMagic.find((candidate) => candidate.matches(buffer))?.mimeType;
}

function assertDeclaredMimeType(file: File): SupportedImageMimeType {
  if (file.type === 'image/jpg') {
    return 'image/jpeg';
  }

  if (file.type === 'image/jpeg' || file.type === 'image/png' || file.type === 'image/webp') {
    return file.type;
  }

  throw new ImageValidationError('지원하지 않는 이미지 형식입니다. JPG, PNG, WebP만 업로드해 주세요.');
}

function outputFormat(mimeType: SupportedImageMimeType): 'jpeg' | 'png' | 'webp' {
  return mimeType === 'image/jpeg' ? 'jpeg' : mimeType === 'image/png' ? 'png' : 'webp';
}

async function validateAndPrepareImage(file: File): Promise<PreparedImage> {
  if (file.size > MAX_IMAGE_BYTES) {
    throw new ImageValidationError('이미지 파일은 10MB 이하만 업로드할 수 있습니다.');
  }

  const declaredMimeType = assertDeclaredMimeType(file);
  const sourceBuffer = Buffer.from(await file.arrayBuffer());
  const detectedMimeType = detectMimeType(sourceBuffer);

  if (detectedMimeType !== declaredMimeType) {
    sourceBuffer.fill(0);
    throw new ImageValidationError('이미지 형식을 확인할 수 없습니다. 파일을 다시 선택해 주세요.');
  }

  try {
    const image = sharp(sourceBuffer, { failOn: 'error' });
    const metadata = await image.metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;

    if (width < 1 || height < 1 || width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
      throw new ImageValidationError('이미지의 가로 또는 세로 크기가 허용 범위를 초과했습니다.');
    }

    if (width * height > MAX_IMAGE_PIXELS) {
      throw new ImageValidationError('이미지의 총 픽셀 수가 64MP를 초과했습니다.');
    }

    const sanitizedBuffer = await image.rotate().toFormat(outputFormat(detectedMimeType)).toBuffer();

    return {
      buffer: sanitizedBuffer,
      mimeType: detectedMimeType,
      width,
      height,
      originalSize: file.size,
    };
  } catch (error) {
    if (error instanceof ImageValidationError) {
      throw error;
    }

    throw new ImageValidationError('손상되었거나 디코딩할 수 없는 이미지입니다.');
  } finally {
    sourceBuffer.fill(0);
  }
}

export async function validateAndPrepareImages(files: File[]): Promise<PreparedImage[]> {
  if (files.length < 1 || files.length > MAX_IMAGES) {
    throw new ImageValidationError('이미지는 1장 이상 3장 이하로 업로드해 주세요.');
  }

  const preparedImages: PreparedImage[] = [];

  try {
    for (const [imageIndex, file] of files.entries()) {
      preparedImages.push({ ...(await validateAndPrepareImage(file)), imageIndex });
    }

    return preparedImages;
  } catch (error) {
    for (const image of preparedImages) {
      image.buffer.fill(0);
    }
    throw error;
  }
}

export function releasePreparedImages(images: PreparedImage[]): void {
  for (const image of images) {
    image.buffer.fill(0);
  }
}

export const imageValidationLimits = {
  maxImages: MAX_IMAGES,
  maxImageBytes: MAX_IMAGE_BYTES,
  maxImageDimension: MAX_IMAGE_DIMENSION,
  maxImagePixels: MAX_IMAGE_PIXELS,
} as const;
