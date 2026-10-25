'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ThemeToggle } from '../../components/theme/theme-toggle';
import { useSearchParams } from 'next/navigation';
import type {
  NlApiMode,
  PublicationWork,
  PublicationVolume,
  VolumeSortOrder,
  VolumeStatusFilter,
} from '../../lib/domain/publication-types';
import { publicationErrorResponseSchema, publicationSearchResponseSchema } from '../../lib/domain/publication-schemas';
import {
  countLoadedVolumes,
  mergePublicationWorkPages,
  mergeUngroupedVolumePages,
  summarizePublicationVolumes,
} from '../../lib/publication/page-merge';
import { filterVolumesByStatus, sortVolumes } from '../../lib/publication/sort-filter';

const statusLabels: Record<PublicationVolume['status'], string> = {
  UPCOMING: '출판예정일 등록',
  DATE_PASSED: '예정일 경과 · 출판 미확인',
  DEPOSITED: '납본 확인',
  REGISTERED: 'ISBN 등록 확인',
  UNKNOWN: '확인 불가',
};

const editionLabels: Record<PublicationVolume['edition'], string> = {
  REGULAR: '일반판',
  SPECIAL: '특별판',
  COMPLETE: '완전판',
  EBOOK: '전자책',
  UNKNOWN: '판본 미확인',
};

const filterOptions: { value: VolumeStatusFilter; label: string }[] = [
  { value: 'ALL', label: '전체' },
  { value: 'UPCOMING', label: '미래 출판예정일 등록' },
  { value: 'DEPOSITED', label: '납본 확인' },
  { value: 'REGISTERED', label: 'ISBN 등록 확인' },
];

const sortOptions: { value: VolumeSortOrder; label: string }[] = [
  { value: 'VOLUME_ASC', label: '권수 오름차순' },
  { value: 'VOLUME_DESC', label: '권수 내림차순' },
  { value: 'EXPECTED_DATE', label: '출판예정일순' },
];

interface Yes24LookupState {
  loading: boolean;
  matched?: boolean;
  productUrl?: string;
  coverUrl?: string;
  skippedInMock?: boolean;
}

function VolumeRow({ volume }: { volume: PublicationVolume }) {
  const [lookup, setLookup] = useState<Yes24LookupState | null>(null);

  async function checkPurchaseInfo() {
    setLookup({ loading: true });
    const params = new URLSearchParams();
    if (volume.isbn) params.set('isbn', volume.isbn);
    params.set('title', volume.title);
    if (volume.author) params.set('author', volume.author);
    try {
      const response = await fetch(`/api/publication/yes24?${params.toString()}`);
      const body = await response.json();
      setLookup({
        loading: false,
        matched: Boolean(body.matched),
        productUrl: body.productUrl,
        coverUrl: body.coverUrl,
        skippedInMock: body.mode === 'mock',
      });
    } catch {
      setLookup({ loading: false, matched: false });
    }
  }

  return (
    <li className="volume-row">
      <div className="volume-cover" aria-hidden={!volume.coverUrl}>
        {volume.coverUrl ? <img src={volume.coverUrl} alt="" width={64} height={90} loading="lazy" /> : <span>표지 없음</span>}
      </div>
      <div className="volume-info">
        <strong>{volume.title}{volume.volumeLabel && !volume.title.includes(volume.volumeLabel) ? ` · ${volume.volumeLabel}` : ''}</strong>
        <div className="badge-row">
          <span>{statusLabels[volume.status]}</span>
          <span>{editionLabels[volume.edition]}</span>
        </div>
        <p className="volume-meta">
          {volume.publisher ?? '출판사 확인 불가'} · {volume.isbn ?? 'ISBN 없음'}
        </p>
        {volume.isbnSource === 'SET_ISBN' && <p className="volume-meta">세트 ISBN</p>}
        {(volume.editionStatement || volume.form) && (
          <p className="volume-meta">{[volume.editionStatement, volume.form].filter(Boolean).join(' · ')}</p>
        )}
        {volume.expectedPublicationDate && (
          <p className="volume-meta">출판예정일 {volume.expectedPublicationDate} (변경될 수 있어요)</p>
        )}
        {volume.isMock && <p className="mock-tag">개발용 Mock 데이터</p>}
        <div className="action-row">
          <button className="quiet-action" type="button" onClick={checkPurchaseInfo} disabled={lookup?.loading}>
            {lookup?.loading ? '확인 중…' : '구매 정보 확인'}
          </button>
          {lookup && !lookup.loading && (
            lookup.skippedInMock && !lookup.matched
              ? <span className="volume-meta">Mock 모드에서는 구매 정보를 조회하지 않아요.</span>
              : lookup.matched && lookup.productUrl
                ? <a className="quiet-action" href={lookup.productUrl} target="_blank" rel="noopener noreferrer">YES24에서 보기 ↗</a>
                : <span className="volume-meta">일치하는 YES24 상품을 찾지 못했어요.</span>
          )}
        </div>
      </div>
    </li>
  );
}

function PublicationSearchView() {
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get('q') ?? '';
  const [inputValue, setInputValue] = useState(initialQuery);
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [mode, setMode] = useState<NlApiMode | null>(null);
  const [works, setWorks] = useState<PublicationWork[]>([]);
  const [ungroupedVolumes, setUngroupedVolumes] = useState<PublicationVolume[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [filter, setFilter] = useState<VolumeStatusFilter>('ALL');
  const [sort, setSort] = useState<VolumeSortOrder>('VOLUME_ASC');

  async function runSearch(query: string, nextPage: number) {
    if (!query.trim()) return;
    nextPage === 1 ? setLoading(true) : setLoadingMore(true);
    setError(null);
    try {
      const response = await fetch(`/api/publication/search?q=${encodeURIComponent(query)}&page=${nextPage}`);
      const body: unknown = await response.json();
      if (!response.ok) {
        const parsedError = publicationErrorResponseSchema.safeParse(body);
        setError(parsedError.success ? parsedError.data.error.message : '검색 요청을 처리하지 못했습니다.');
        return;
      }
      const parsed = publicationSearchResponseSchema.safeParse(body);
      if (!parsed.success) {
        setError('검색 결과를 확인하지 못했습니다. 다시 시도해 주세요.');
        return;
      }
      const data = parsed.data;
      setWorks((previous) => nextPage === 1 ? data.works : mergePublicationWorkPages(previous, data.works));
      setUngroupedVolumes((previous) => nextPage === 1
        ? data.ungroupedVolumes
        : mergeUngroupedVolumePages(previous, data.ungroupedVolumes));
      setTotalCount(data.totalCount);
      setMode(data.mode);
      setPage(data.page);
      setHasMore(data.hasMore);
      setSubmittedQuery(query);
      setSearched(true);
    } catch {
      setError('네트워크 연결을 확인하고 다시 시도해 주세요.');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  // URL ?q= is the one explicit exception to "no API calls on page entry alone".
  useEffect(() => {
    if (initialQuery) void runSearch(initialQuery, 1);
  }, []);

  const visibleWorks = useMemo(() => works
    .map((work) => ({ ...work, volumes: sortVolumes(filterVolumesByStatus(work.volumes, filter), sort) }))
    .filter((work) => work.volumes.length > 0), [works, filter, sort]);
  const visibleUngrouped = sortVolumes(filterVolumesByStatus(ungroupedVolumes, filter), sort);
  const primaryWorks = visibleWorks.filter((work) => work.relevanceBand === 'HIGH' && work.mangaClassification !== 'NON_MANGA_LIKELY');
  const additionalWorks = visibleWorks.filter((work) => work.relevanceBand === 'LOW' || work.mangaClassification === 'NON_MANGA_LIKELY');
  const additionalCount = additionalWorks.length + visibleUngrouped.length;
  const loadedCount = countLoadedVolumes(works, ungroupedVolumes);

  function renderWorks(items: PublicationWork[]) {
    return (
      <div className="candidate-list">
        {items.map((work) => {
          const summary = summarizePublicationVolumes(work.volumes);
          const classification = work.mangaClassification ?? 'UNCERTAIN';
          return (
            <article className="candidate-card work-card" key={work.workKey}>
              <div className="candidate-content">
                <h3 className="japanese-title-heading">{work.title}</h3>
                <p className="pronunciation">{work.author ?? '저자 확인 불가'} · {work.publisher ?? '출판사 확인 불가'}</p>
                <span className={`publication-type publication-type-${classification.toLowerCase()}`}>
                  {classification === 'MANGA_LIKELY' ? '만화 가능성 높음' : classification === 'NON_MANGA_LIKELY' ? '비만화 근거 있음' : '유형 미확인'}
                </span>
                <p className="volume-meta">
                  현재 검색된 {work.volumes.length}권 · 출판예정일 등록 {summary.upcomingCount}권 · 납본 확인 최고 권수 {summary.highestDepositedVolume ?? '미확인'}
                </p>
                <ul className="volume-list">
                  {work.volumes.map((volume) => <VolumeRow volume={volume} key={volume.recordId} />)}
                </ul>
              </div>
            </article>
          );
        })}
      </div>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <Link className="brand" href="/">MangaFind</Link>
        <nav aria-label="주요 메뉴"><Link href="/search">이미지로 찾기</Link></nav>
        <ThemeToggle />
      </header>
      <section className="search-section" aria-labelledby="publication-title">
        <div className="section-heading">
          <div><span className="section-kicker">Publication search</span><h1 id="publication-title">출판 정보 검색</h1></div>
        </div>
        <form
          className="publication-search-form"
          onSubmit={(event) => {
            event.preventDefault();
            setWorks([]);
            setUngroupedVolumes([]);
            setTotalCount(0);
            void runSearch(inputValue, 1);
          }}
        >
          <label className="sr-only" htmlFor="publication-query">만화 제목 또는 ISBN 입력</label>
          <input
            id="publication-query"
            name="q"
            type="text"
            placeholder="만화 제목 또는 ISBN 입력…"
            value={inputValue}
            onChange={(event) => setInputValue(event.target.value)}
            autoComplete="off"
          />
          <button className="primary-action" type="submit" disabled={loading || !inputValue.trim()}>
            {loading ? '검색 중…' : '검색'}
          </button>
        </form>
        {mode === 'mock' && <p className="mock-banner" role="status">⚠ 개발용 Mock 데이터입니다. 실제 출판 정보가 아닙니다.</p>}
        {error && <div className="inline-error" role="alert">{error}</div>}
      </section>

      {searched && !error && (
        <section className="results-panel" aria-labelledby="publication-results-title">
          <div className="result-heading">
            <div><span className="section-kicker">검색 결과</span><h2 id="publication-results-title">&ldquo;{submittedQuery}&rdquo; 만화 검색 결과</h2></div>
            <div className="filter-sort-row">
              <select aria-label="출판 상태 필터" value={filter} onChange={(event) => setFilter(event.target.value as VolumeStatusFilter)}>
                {filterOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <select aria-label="정렬 기준" value={sort} onChange={(event) => setSort(event.target.value as VolumeSortOrder)}>
                {sortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </div>
          </div>
          <p className="volume-meta">전체 검색 결과 {totalCount}건 · 현재 {loadedCount}건 조회</p>

          {primaryWorks.length === 0 && additionalCount === 0 && (
            <p className="partial-note">조건에 맞는 작품을 찾지 못했어요. 다른 검색어나 필터를 시도해 보세요.</p>
          )}

          {primaryWorks.length > 0 ? renderWorks(primaryWorks) : additionalCount > 0 ? (
            <p className="partial-note">만화로 판단할 근거가 충분한 작품은 없습니다. 추가 검색 결과를 확인해 주세요.</p>
          ) : null}

          {additionalCount > 0 && (
            <details className="publication-additional">
              <summary>추가 검색 결과 ({additionalCount})</summary>
              <p className="volume-meta">제목 관련도가 낮거나 비만화 근거가 있는 도서입니다. 조회된 출판 정보는 유지됩니다.</p>
              {additionalWorks.length > 0 && renderWorks(additionalWorks)}
              {visibleUngrouped.length > 0 && (
                <div className="candidate-list">
                  <h3 className="ungrouped-heading">작품 그룹화가 확실하지 않은 도서</h3>
                  <ul className="volume-list">
                    {visibleUngrouped.map((volume) => <VolumeRow volume={volume} key={volume.recordId} />)}
                  </ul>
                </div>
              )}
            </details>
          )}

          {hasMore && (
            <div className="action-row">
              <button className="quiet-action" type="button" disabled={loadingMore} onClick={() => void runSearch(submittedQuery, page + 1)}>
                {loadingMore ? '불러오는 중…' : '더 보기'}
              </button>
            </div>
          )}
        </section>
      )}

      <footer className="footer"><span>MangaFind V1</span><span>출판 정보는 국립중앙도서관 서지정보를 바탕으로 제공됩니다.</span></footer>
    </main>
  );
}

export default function PublicationPage() {
  return (
    <Suspense fallback={<main className="app-shell"><p className="partial-note">불러오는 중…</p></main>}>
      <PublicationSearchView />
    </Suspense>
  );
}
