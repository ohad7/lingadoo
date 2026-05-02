const DEFAULT_ENV = import.meta.env || {};
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);

function normalizeMeasurementId(value) {
  const id = String(value || '').trim();
  return /^G-[A-Z0-9]+$/u.test(id) ? id : '';
}

export function getAnalyticsMeasurementId(env = DEFAULT_ENV) {
  return normalizeMeasurementId(env?.VITE_GA_MEASUREMENT_ID);
}

export function shouldEnableAnalytics({
  env = DEFAULT_ENV,
  hostname = globalThis.location?.hostname || '',
} = {}) {
  const measurementId = getAnalyticsMeasurementId(env);
  if (!measurementId) {
    return false;
  }
  if (env?.DEV || (env?.MODE && env.MODE !== 'production' && !env?.PROD)) {
    return false;
  }
  if (LOCAL_HOSTNAMES.has(String(hostname || '').toLowerCase())) {
    return false;
  }
  return true;
}

export function initializeAnalytics({
  env = DEFAULT_ENV,
  documentObject = globalThis.document,
  windowObject = globalThis.window,
} = {}) {
  if (!documentObject || !windowObject || !shouldEnableAnalytics({ env, hostname: windowObject.location?.hostname })) {
    return false;
  }

  const measurementId = getAnalyticsMeasurementId(env);
  if (documentObject.querySelector(`script[data-lingadoo-ga="${measurementId}"]`)) {
    return true;
  }

  windowObject.dataLayer = windowObject.dataLayer || [];
  windowObject.gtag = windowObject.gtag || function gtag() {
    windowObject.dataLayer.push(arguments);
  };
  windowObject.gtag('js', new Date());
  windowObject.gtag('config', measurementId, {
    send_page_view: true,
  });

  const script = documentObject.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
  script.dataset.lingadooGa = measurementId;
  documentObject.head.appendChild(script);
  return true;
}
