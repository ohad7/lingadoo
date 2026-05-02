import { useEffect, useRef, useState } from 'react';
import type { UploadJobState } from '../api/types';
import { phaseToStage, getProgressMessage, STAGES as _STAGES } from '../lib/progressMessages.js';

const STAGES = _STAGES as readonly string[];

type ProgressTone = 'calm' | 'playful' | 'silly';

type UploadProgressModalProps = {
  uploadJob: UploadJobState;
  filename: string;
  embedded?: boolean;
  title?: string;
  progressTone?: ProgressTone;
  workingHarder?: boolean;
  subProgress?: number;
  sourceLanguage?: string;
  targetLanguage?: string;
  enhancementPending?: boolean;
  enhancementActive?: boolean;
  enhancementProgress?: number;
};

const STAGE_DEFINITIONS = [
  { key: 'reading', label: 'Reading your document' },
  { key: 'preparing', label: 'Getting ready to translate' },
  { key: 'translating', label: 'Translating' },
  { key: 'finishing', label: 'Putting it all together' },
];

function stageState(stageKey: string, currentStage: string, isSucceeded: boolean): 'done' | 'active' | 'pending' {
  if (isSucceeded) return 'done';
  const currentIndex = STAGES.indexOf(currentStage);
  const thisIndex = STAGES.indexOf(stageKey);
  if (thisIndex < currentIndex) return 'done';
  if (thisIndex === currentIndex) return 'active';
  return 'pending';
}

function formatElapsed(ms: number): string {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  const minutes = Math.floor(seconds / 60);
  const remain = seconds % 60;
  if (minutes <= 0) return `${remain}s`;
  return `${minutes}m ${remain}s`;
}

function formatPageCounter(pagesDone: number, pagesTotal: number, isRunning: boolean): string | null {
  if (pagesTotal <= 0) return null;
  const done = Math.max(0, Math.min(pagesTotal, pagesDone));
  const current = isRunning && done < pagesTotal ? done + 1 : done;
  return `${current} / ${pagesTotal}`;
}

function preparingLabel(sourceLanguage?: string, targetLanguage?: string): string {
  if (sourceLanguage && targetLanguage) {
    return `Getting ready to translate ${sourceLanguage} to ${targetLanguage}`;
  }
  return 'Getting ready to translate';
}

export default function UploadProgressModal({
  uploadJob,
  filename,
  embedded = false,
  title,
  progressTone = 'silly',
  workingHarder = false,
  subProgress,
  sourceLanguage,
  targetLanguage,
  enhancementPending = false,
  enhancementActive = false,
  enhancementProgress = 0,
}: UploadProgressModalProps) {
  const isSucceeded = uploadJob.status === 'succeeded';
  const isFailed = uploadJob.status === 'failed';

  // When enhancement is active, main stages are all done
  const mainDone = enhancementActive || isSucceeded;

  // Map internal phase to user-facing stage
  const currentStage = mainDone ? 'finishing' : phaseToStage(uploadJob.current_phase);
  const currentStageIndex = Math.max(0, STAGES.indexOf(currentStage));

  // Sub-progress: page fraction within the current stage
  const pagesTotal = Math.max(0, Number(uploadJob.pages_total) || 0);
  const pagesDone = Math.max(0, Math.min(pagesTotal, Number(uploadJob.pages_done) || 0));
  const hasPageProgress = !mainDone && pagesTotal > 0 && (currentStage === 'translating' || currentStage === 'reading' || currentStage === 'finishing');
  const pageCounter = hasPageProgress
    ? formatPageCounter(pagesDone, pagesTotal, uploadJob.status === 'running')
    : null;

  // Compute stage fraction for smooth progress bar
  // For the finishing stage, fit_pages covers 0–0.7, render_outputs 0.7, create_working_session 0.9
  const currentPhase = uploadJob.current_phase;
  let stageFraction = 0;
  if (currentStage === 'finishing' && !mainDone) {
    if (currentPhase === 'fit_pages' && hasPageProgress && pagesTotal > 0) {
      stageFraction = 0.7 * Math.max(0, Math.min(1, pagesDone / pagesTotal));
    } else if (currentPhase === 'render_outputs') {
      stageFraction = 0.7;
    } else if (currentPhase === 'create_working_session') {
      stageFraction = 0.9;
    }
  } else if (hasPageProgress && pagesTotal > 0) {
    stageFraction = Math.max(0, Math.min(1, pagesDone / pagesTotal));
  } else if (!mainDone && typeof subProgress === 'number' && Number.isFinite(subProgress)) {
    stageFraction = Math.max(0, Math.min(1, subProgress));
  }

  // Mini sub-bar percent
  const subBarPercent = hasPageProgress && pagesTotal > 0
    ? Math.max(0, Math.min(100, (pagesDone / pagesTotal) * 100))
    : !mainDone && typeof subProgress === 'number' && Number.isFinite(subProgress)
      ? Math.max(0, Math.min(100, subProgress * 100))
      : 0;
  const showSubBar = !mainDone && (hasPageProgress || (typeof subProgress === 'number' && subProgress > 0));

  // Overall progress: each stage = 25%
  const stageCount = STAGE_DEFINITIONS.length;
  const percent = mainDone
    ? 100
    : Math.round(((currentStageIndex + stageFraction) / stageCount) * 1000) / 10;

  // Elapsed time — only show after 30 seconds
  const elapsedMs = Math.max(0, Number(uploadJob.elapsed_ms) || 0);
  const showElapsed = elapsedMs >= 30_000;
  const elapsed = formatElapsed(elapsedMs);

  // Rotating message for main progress
  const [rotatingMessage, setRotatingMessage] = useState(() =>
    getProgressMessage(progressTone, currentStage, workingHarder),
  );
  const [messageFading, setMessageFading] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stageRef = useRef(currentStage);
  const toneRef = useRef(progressTone);
  const harderRef = useRef(workingHarder);
  const enhActiveRef = useRef(enhancementActive);

  // Track latest values for the interval callback
  stageRef.current = currentStage;
  toneRef.current = progressTone;
  harderRef.current = workingHarder;
  enhActiveRef.current = enhancementActive;

  // Reset message immediately on stage change
  useEffect(() => {
    if (!enhancementActive) {
      setRotatingMessage(getProgressMessage(progressTone, currentStage, workingHarder));
      setMessageFading(false);
    }
  }, [currentStage, progressTone, workingHarder, enhancementActive]);

  // Rotate every 4.5 seconds
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      if (enhActiveRef.current) return; // Enhancement has its own message rotation
      setMessageFading(true);
      setTimeout(() => {
        setRotatingMessage(
          getProgressMessage(toneRef.current, stageRef.current, harderRef.current),
        );
        setMessageFading(false);
      }, 300);
    }, 4500);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  // Enhancement section rotating message
  const [enhMessage, setEnhMessage] = useState(() =>
    getProgressMessage(progressTone, 'reading', true),
  );
  const [enhFading, setEnhFading] = useState(false);
  const enhIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const enhancementVisible = enhancementPending || enhancementActive;
  useEffect(() => {
    if (!enhancementVisible) return;
    // Start enhancement message rotation
    setEnhMessage(getProgressMessage(progressTone, 'reading', true));
    enhIntervalRef.current = setInterval(() => {
      setEnhFading(true);
      setTimeout(() => {
        setEnhMessage(getProgressMessage(toneRef.current, 'reading', true));
        setEnhFading(false);
      }, 300);
    }, 4500);
    return () => {
      if (enhIntervalRef.current) clearInterval(enhIntervalRef.current);
    };
  }, [enhancementVisible, progressTone]);

  // Track recently completed stages for animation
  const [animatingStages, setAnimatingStages] = useState<Set<string>>(new Set());
  const prevStageRef = useRef(currentStage);

  useEffect(() => {
    if (prevStageRef.current !== currentStage) {
      const prevIndex = STAGES.indexOf(prevStageRef.current);
      const currIndex = STAGES.indexOf(currentStage);
      if (currIndex > prevIndex) {
        const newlyCompleted = STAGES.slice(prevIndex, currIndex);
        setAnimatingStages(prev => {
          const next = new Set(prev);
          newlyCompleted.forEach((s: string) => next.add(s));
          return next;
        });
        setTimeout(() => {
          setAnimatingStages(prev => {
            const next = new Set(prev);
            newlyCompleted.forEach((s: string) => next.delete(s));
            return next;
          });
        }, 500);
      }
      prevStageRef.current = currentStage;
    }
  }, [currentStage]);

  // When enhancement activates, animate all remaining stages to done
  const enhAnimatedRef = useRef(false);
  useEffect(() => {
    if (enhancementActive && !enhAnimatedRef.current) {
      enhAnimatedRef.current = true;
      const allStageKeys = STAGES.slice(0);
      setAnimatingStages(new Set(allStageKeys));
      setTimeout(() => {
        setAnimatingStages(new Set());
      }, 500);
    }
  }, [enhancementActive]);

  const enhPercent = Math.max(0, Math.min(100, enhancementProgress));

  const content = (
    <div className={embedded ? 'progress-content' : 'modal-content progress-content'}>
      <div className="modal-header">
        <h2>{title || `Translating ${filename}`}</h2>
      </div>

      {/* Main progress bar */}
      <div className="progress-bar">
        <div
          className={`progress-bar-fill${workingHarder && !enhancementActive ? ' progress-bar-fill--amber' : ''}`}
          style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
        />
      </div>

      {/* Rotating message + elapsed time (fades out when enhancement takes over) */}
      {!isFailed && (
        <div className={`progress-status-row${enhancementActive ? ' progress-status-row--hidden' : ''}`}>
          <span className={`rotating-message${messageFading ? ' rotating-message--fading' : ''}`}>
            {rotatingMessage}
          </span>
          {showElapsed && (
            <span className="progress-elapsed">{elapsed}</span>
          )}
        </div>
      )}

      {/* Error message */}
      {isFailed && (
        <div style={{ color: 'var(--danger)', margin: '0 0 16px' }}>
          <p style={{ fontWeight: 500, marginBottom: 8 }}>We couldn&apos;t open this file with the current method</p>
          <p style={{ fontSize: '0.9rem' }}>{uploadJob.error || 'Please try again or use a different method.'}</p>
        </div>
      )}

      {/* Stage checklist */}
      <ul className="phase-list">
        {STAGE_DEFINITIONS.map(stage => {
          const state = mainDone ? 'done' : stageState(stage.key, currentStage, isSucceeded);
          const isAnimating = animatingStages.has(stage.key);
          let icon: string;
          if (state === 'done') icon = '\u2713';
          else if (state === 'active') icon = '\u25cf';
          else icon = '\u25cb';

          const label = stage.key === 'preparing'
            ? preparingLabel(sourceLanguage, targetLanguage)
            : stage.label;

          const showCounter = state === 'active' && pageCounter;
          const showStageSub = state === 'active' && showSubBar;

          return (
            <li
              key={stage.key}
              className={[
                'phase-item',
                `phase-${state}`,
                isAnimating ? 'phase-complete-anim' : '',
                workingHarder && state === 'active' ? 'phase-active--amber' : '',
              ].filter(Boolean).join(' ')}
            >
              <div className="phase-item-row">
                <span className={`phase-icon${isAnimating ? ' phase-icon-pop' : ''}`}>{icon}</span>
                <span className="phase-label">{label}</span>
                {showStageSub && (
                  <div className={`phase-sub-bar${workingHarder ? ' phase-sub-bar--amber' : ''}`}>
                    <div
                      className="phase-sub-bar-fill"
                      style={{ width: `${subBarPercent}%` }}
                    />
                  </div>
                )}
                {showCounter && (
                  <span className="phase-page-counter">{pageCounter}</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {/* Enhancement section — always rendered, animated in via CSS */}
      <div className={`enhancement-section${enhancementPending || enhancementActive ? ' enhancement-section--visible' : ''}`}>
        <hr className="enhancement-divider" />
        <p className="enhancement-notice">
          We noticed this document could use extra attention &mdash; preparing a few versions for you to compare.
        </p>
        <div className="progress-bar">
          <div
            className="progress-bar-fill progress-bar-fill--amber"
            style={{ width: `${enhPercent}%` }}
          />
        </div>
        <div className="progress-status-row">
          <span className={`rotating-message${enhFading ? ' rotating-message--fading' : ''}`}>
            {enhMessage}
          </span>
          {showElapsed && (
            <span className="progress-elapsed">{elapsed}</span>
          )}
        </div>
      </div>
    </div>
  );

  if (embedded) {
    return content;
  }

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        {content}
      </div>
    </div>
  );
}
