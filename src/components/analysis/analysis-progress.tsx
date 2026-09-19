import type { StageStatus } from '../../lib/domain/types';

interface AnalysisProgressProps {
  stages: {
    imageAnalysis: StageStatus;
    finalJudgment: StageStatus;
  };
}

const labels = [
  ['imageAnalysis', '이미지 분석·검색'],
  ['finalJudgment', 'TOP 3·한국 정보 정리'],
] as const;

export function AnalysisProgress({ stages }: AnalysisProgressProps) {
  return (
    <ol className="stage-list" aria-label="분석 진행 상태" aria-live="polite">
      {labels.map(([key, label]) => {
        const status = stages[key];
        return (
          <li className={`stage-row stage-${status.toLowerCase()}`} key={key}>
            <span className="stage-dot" aria-hidden="true" />
            <span>{label}</span>
            <small>{status === 'SUCCESS' ? '완료' : status === 'SKIPPED' ? '대기' : status === 'TIMEOUT' ? '시간 초과' : status === 'FAILED' ? '실패' : status === 'INSUFFICIENT' ? '정보 부족' : status === 'PARTIAL' ? '일부 완료' : '진행 중'}</small>
          </li>
        );
      })}
    </ol>
  );
}
