export type IdentifyEventName =
  | 'identify_started'
  | 'image_validation_completed'
  | 'stage_started'
  | 'stage_completed'
  | 'stage_failed'
  | 'search_diagnostic'
  | 'link_delivery_checked'
  | 'identify_completed';

interface IdentifyEvent {
  event: IdentifyEventName;
  requestId: string;
  stage?: string;
  status?: string;
  latencyMs?: number;
  model?: string;
  imageCount?: number;
  outcome?: string;
  diagnosticCode?: string;
  namuWikiCount?: number;
  yes24Count?: number;
  yes24CoverCount?: number;
}

export function logIdentifyEvent(event: IdentifyEvent): void {
  const safeEvent = Object.fromEntries(
    Object.entries(event).filter(([, value]) => value !== undefined),
  );
  console.info(JSON.stringify(safeEvent));
}
