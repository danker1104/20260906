export type IdentifyEventName =
  | 'identify_started'
  | 'image_validation_completed'
  | 'stage_started'
  | 'stage_completed'
  | 'stage_failed'
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
}

export function logIdentifyEvent(event: IdentifyEvent): void {
  const safeEvent = Object.fromEntries(
    Object.entries(event).filter(([, value]) => value !== undefined),
  );
  console.info(JSON.stringify(safeEvent));
}
