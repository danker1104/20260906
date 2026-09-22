import type { IdentifyResponse } from '../../lib/domain/types';

interface ResultPanelProps {
  result: IdentifyResponse;
}

const titleStatusLabels = {
  OFFICIAL: '정식 제목',
  COMMON: '국내 통용명',
  TRANSLATED: 'AI 참고 번역',
  UNKNOWN: '확인 불충분',
} as const;

const publicationLabels = {
  CONFIRMED: '정발 확인',
  NOT_FOUND: '정발 정보 없음',
  UNKNOWN: '확인 불충분',
} as const;

export function ResultPanel({ result }: ResultPanelProps) {
  if (result.status === 'INSUFFICIENT') {
    return <div className="state-panel"><span className="state-kicker">정보 부족</span><h2>작품을 특정할 단서가 부족해요.</h2><p>대사나 캐릭터 이름이 더 잘 보이는 캡처를 추가해 주세요.</p></div>;
  }

  if (result.status === 'FAILED') {
    return <div className="state-panel state-error"><span className="state-kicker">AI 처리 실패</span><h2>검색을 완료하지 못했어요.</h2><p>이미지 형식은 확인됐지만 AI 분석 또는 검색 단계에서 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.</p></div>;
  }

  const hasKoreanInformation = result.candidates.some((candidate) => (
    Boolean(candidate.koreanTitle)
    || candidate.koreanTitleStatus !== 'UNKNOWN'
    || candidate.publicationStatus !== 'UNKNOWN'
  ));

  return (
    <section className="results-panel" aria-labelledby="results-title">
      <div className="result-heading">
        <div><span className="section-kicker">검색 결과</span><h2 id="results-title">찾아낸 작품 후보</h2></div>
        {result.status === 'PARTIAL_SUCCESS' && !hasKoreanInformation && <p className="partial-note">일부 후보의 한국 정보가 확인되지 않았습니다.</p>}
      </div>
      <div className="candidate-list">
        {result.candidates.map((candidate) => (
          <article className={`candidate-card ${candidate.rank === 1 ? 'candidate-primary' : ''}`} key={candidate.rank}>
            <div className="candidate-rank">#{candidate.rank}</div>
            <div className="candidate-content">
              <h3 className="japanese-title-heading">{candidate.japaneseTitle}</h3>
              {candidate.pronunciation && <p className="pronunciation">{candidate.pronunciation}</p>}
              {(candidate.koreanTitle || candidate.koreanTitleStatus !== 'UNKNOWN' || candidate.publicationStatus !== 'UNKNOWN') && (
                <section className="korean-info" aria-labelledby={`korean-info-${candidate.rank}`}>
                  <h4 id={`korean-info-${candidate.rank}`}>한국어 정보</h4>
                  <p className="korean-title">{candidate.koreanTitle ?? '한국어 제목 확인 불충분'}</p>
                  <div className="badge-row"><span>{titleStatusLabels[candidate.koreanTitleStatus]}</span><span>{publicationLabels[candidate.publicationStatus]}</span></div>
                </section>
              )}
              {candidate.yes24?.matched && candidate.yes24.coverUrl && candidate.yes24.productUrl && (
                <aside className="yes24-card" aria-label="YES24 한국판 도서 정보">
                  <a className="yes24-cover-link" href={candidate.yes24.productUrl} target="_blank" rel="noopener noreferrer" aria-label={`${candidate.yes24.title ?? candidate.koreanTitle ?? '한국판 도서'} YES24에서 보기`}>
                    <img className="yes24-cover" src={candidate.yes24.coverUrl} alt={`${candidate.yes24.title ?? candidate.koreanTitle ?? '한국판 도서'} 표지`} loading="lazy" />
                  </a>
                  <div className="yes24-copy">
                    <span className="yes24-source">YES24</span>
                    <h4>{candidate.yes24.title ?? candidate.koreanTitle}</h4>
                    {candidate.yes24.publisher && <p>{candidate.yes24.publisher}</p>}
                    <a className="yes24-product-link" href={candidate.yes24.productUrl} target="_blank" rel="noopener noreferrer">YES24에서 보기 <span aria-hidden="true">↗</span></a>
                  </div>
                </aside>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
