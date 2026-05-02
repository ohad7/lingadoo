export type ProgressTone = 'calm' | 'playful' | 'silly';
export type ProgressStage = 'reading' | 'preparing' | 'translating' | 'finishing';

export declare const STAGES: readonly ProgressStage[];

export declare const LOADING_MESSAGES: string[];

export declare const PROGRESS_MESSAGES: Record<ProgressTone, Record<ProgressStage, string[]>>;
export declare const WORKING_HARDER_MESSAGES: Record<ProgressTone, string[]>;

export declare function phaseToStage(phase: string): ProgressStage;
export declare function getProgressMessage(
  tone: ProgressTone,
  stage: ProgressStage,
  workingHarder?: boolean,
): string;
