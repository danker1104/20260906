'use client';

import { emitSceneEvent } from '../../lib/spline/scene-bus';

interface ImageUploaderProps {
  files: File[];
  disabled: boolean;
  onFilesChange: (files: File[]) => void;
}

const acceptedTypes = 'image/jpeg,image/png,image/webp';

export function ImageUploader({ files, disabled, onFilesChange }: ImageUploaderProps) {
  function addFiles(fileList: FileList | null) {
    if (!fileList) return;
    const nextFiles = [...files, ...Array.from(fileList)].slice(0, 3);
    onFilesChange(nextFiles);
  }

  function handleDrop(event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    if (disabled) return;
    addFiles(event.dataTransfer.files);
    emitSceneEvent('upload:drop');
  }

  return (
    <div className="upload-panel">
      <label
        className="upload-dropzone"
        htmlFor="manga-images"
        onMouseEnter={() => emitSceneEvent('upload:hover')}
        onMouseLeave={() => emitSceneEvent('upload:unhover')}
        onDragEnter={() => emitSceneEvent('upload:drag')}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => emitSceneEvent('upload:unhover')}
        onDrop={handleDrop}
      >
        <span className="upload-mark" aria-hidden="true">+</span>
        <span className="upload-title">캡처를 올려주세요</span>
        <span className="upload-hint">JPG, PNG, WebP · 최대 3장 · 파일당 10MB · 드래그해서 놓아도 돼요</span>
        <input
          id="manga-images"
          type="file"
          accept={acceptedTypes}
          multiple
          disabled={disabled}
          onChange={(event) => addFiles(event.target.files)}
        />
      </label>
      {files.length > 0 && (
        <div className="preview-grid" aria-label="선택한 이미지">
          {files.map((file, index) => (
            <div className="preview-item" key={`${file.name}-${file.lastModified}`}>
              <span>{index + 1}</span>
              <strong>{file.name}</strong>
              <button
                type="button"
                aria-label={`${file.name} 제거`}
                disabled={disabled}
                onClick={() => onFilesChange(files.filter((_, fileIndex) => fileIndex !== index))}
              >
                제거
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
