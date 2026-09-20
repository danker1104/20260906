'use client';

import { useState } from 'react';
import { AnalysisProgress } from '../../components/analysis/analysis-progress';
import { ResultPanel } from '../../components/results/result-panel';
import { ImageUploader } from '../../components/upload/image-uploader';
import type { IdentifyResponse } from '../../lib/domain/types';
import { emitSceneEvent } from '../../lib/spline/scene-bus';

const initialStages = { imageAnalysis: 'SKIPPED', finalJudgment: 'SKIPPED' } as const;

export default function SearchPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [result, setResult] = useState<IdentifyResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function identify() {
    if (files.length === 0 || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    emitSceneEvent('pipeline:start');
    const formData = new FormData();
    files.forEach((file) => formData.append('images', file));
    try {
      const response = await fetch('/api/identify', { method: 'POST', body: formData });
      const body = await response.json();
      if (!response.ok) {
        setError(body?.error?.message ?? '검색 요청을 처리하지 못했습니다.');
        emitSceneEvent('pipeline:error');
        return;
      }
      setResult(body as IdentifyResponse);
      emitSceneEvent('pipeline:success');
    } catch {
      setError('네트워크 연결을 확인하고 다시 시도해 주세요.');
      emitSceneEvent('pipeline:error');
    } finally {
      setLoading(false);
    }
  }

  function resetSearch() {
    setFiles([]);
    setResult(null);
    setError(null);
  }

  return (
    <main className="app-shell">
      <header className="topbar"><a className="brand" href="/">MangaFind</a><span className="topbar-note">Japanese manga search</span></header>
      <section className="search-section" aria-labelledby="upload-title"><div className="section-heading"><div><span className="section-kicker">Start here</span><h2 id="upload-title">장면을 선택하세요</h2></div><span className="step-count">1 — 3 images</span></div><p className="privacy-note">이미지는 외부 AI 분석에 사용될 수 있으며, 처리 후 서버에 원본을 저장하지 않습니다.</p><ImageUploader files={files} disabled={loading} onFilesChange={setFiles} /><div className="action-row"><button className="primary-action" type="button" disabled={files.length === 0 || loading} onClick={identify} onMouseEnter={() => emitSceneEvent('cta:hover')} onMouseLeave={() => emitSceneEvent('cta:unhover')}>{loading ? '찾는 중...' : '만화 찾기'}</button>{(files.length > 0 || result) && <button className="quiet-action" type="button" disabled={loading} onClick={resetSearch}>다시 선택</button>}</div></section>
      <section className="hero" aria-labelledby="page-title"><div className="hero-copy"><span className="section-kicker">Screenshot to story</span><h1 id="page-title">이 만화,<br /><em>뭐였지?</em></h1><p>SNS에서 발견한 일본 만화를<br />캡처 한 장으로 찾아보세요.</p></div><div className="hero-signal" aria-hidden="true"><span>01</span><span>image clue</span><span>→</span><span>verified title</span></div></section>
      {loading && <section className="analysis-section"><div className="section-heading"><div><span className="section-kicker">Live analysis</span><h2>단서를 이어 붙이고 있어요</h2></div></div><AnalysisProgress stages={initialStages} /></section>}
      {error && <div className="inline-error" role="alert">{error}</div>}
      {result && <ResultPanel result={result} />}
      <footer className="footer"><span>MangaFind V1</span><span>검색 결과는 현재 브라우저 세션에만 표시됩니다.</span></footer>
    </main>
  );
}