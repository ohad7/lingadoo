export function getAnalyticsMeasurementId(env?: Record<string, unknown>): string;

export function shouldEnableAnalytics(options?: {
  env?: Record<string, unknown>;
  hostname?: string;
}): boolean;

export function initializeAnalytics(options?: {
  env?: Record<string, unknown>;
  documentObject?: Document;
  windowObject?: Window;
}): boolean;
