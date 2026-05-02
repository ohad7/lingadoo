export type SupportedLocale = 'en' | 'he' | 'ar' | 'fr' | 'de' | 'it';

type CompatibilityIssueCopy = {
  label: string;
  detail: string;
};

export type LocaleConfig = {
  code: SupportedLocale;
  dir: 'ltr' | 'rtl';
  path: string;
  title: string;
  subtitle: string;
  dropZoneText: string;
  dropZoneBrowse: string;
  stepUploadLabel: string;
  stepUploadDesc: string;
  stepTranslateLabel: string;
  stepTranslateDesc: string;
  stepDownloadLabel: string;
  stepDownloadDesc: string;
  editSubtitle: string;
  stepEditLabel: string;
  stepEditDesc: string;
  compatibilityChecking: string;
  compatibilityBlockedTitle: string;
  compatibilityBlockedIntro: string;
  compatibilityLimitedTitle: string;
  compatibilityLimitedIntro: string;
};

export const HOME_LOCALES: Record<SupportedLocale, LocaleConfig> = {
  en: {
    code: 'en',
    dir: 'ltr',
    path: '/',
    title: 'Lingadoo',
    subtitle: 'PDF translation made easy',
    dropZoneText: 'Drop a PDF here',
    dropZoneBrowse: 'or click to browse',
    stepUploadLabel: 'Upload',
    stepUploadDesc: 'Upload your PDF document',
    stepTranslateLabel: 'Translate',
    stepTranslateDesc: 'We translate and preserve the layout',
    stepDownloadLabel: 'Download',
    stepDownloadDesc: 'Get the translated PDF',
    editSubtitle: 'Edit your PDF with ease',
    stepEditLabel: 'Edit',
    stepEditDesc: 'Adjust text, layout and fonts',
    compatibilityChecking: 'Checking browser compatibility…',
    compatibilityBlockedTitle: 'Use Lingadoo in Chrome or Edge on desktop',
    compatibilityBlockedIntro: 'Lingadoo currently supports desktop Google Chrome and Microsoft Edge only.',
    compatibilityLimitedTitle: 'Some local features are unavailable',
    compatibilityLimitedIntro: 'Lingadoo can still open documents locally, but some features will be limited.',
  },
  he: {
    code: 'he',
    dir: 'rtl',
    path: '/he',
    title: 'Lingadoo',
    subtitle: 'תרגום PDF בלי לאבד את הצורה',
    dropZoneText: 'גררו לכאן קובץ PDF',
    dropZoneBrowse: 'או לחצו כדי לבחור קובץ',
    stepUploadLabel: 'העלאה',
    stepUploadDesc: 'מעלים את מסמך ה־PDF',
    stepTranslateLabel: 'תרגום',
    stepTranslateDesc: 'המערכת מתרגמת ושומרת על הפריסה',
    stepDownloadLabel: 'הורדה',
    stepDownloadDesc: 'מורידים את ה־PDF המתורגם',
    editSubtitle: 'עריכת PDF בקלות',
    stepEditLabel: 'עריכה',
    stepEditDesc: 'התאימו טקסט, פריסה וגופנים',
    compatibilityChecking: 'בודקים תאימות של הדפדפן…',
    compatibilityBlockedTitle: 'יש לפתוח את Lingadoo ב-Chrome או ב-Edge במחשב',
    compatibilityBlockedIntro: 'כרגע Lingadoo נתמך רק ב-Google Chrome וב-Microsoft Edge במחשב.',
    compatibilityLimitedTitle: 'חלק מהיכולות המקומיות אינן זמינות',
    compatibilityLimitedIntro: 'אפשר עדיין לפתוח מסמכים מקומית, אבל חלק מהיכולות יהיו מוגבלות.',
  },
  ar: {
    code: 'ar',
    dir: 'rtl',
    path: '/ar',
    title: 'Lingadoo',
    subtitle: 'ترجمة ملفات PDF بسهولة مع الحفاظ على التنسيق',
    dropZoneText: 'أسقط ملف PDF هنا',
    dropZoneBrowse: 'أو انقر لاختيار ملف',
    stepUploadLabel: 'رفع',
    stepUploadDesc: 'ارفع ملف PDF الخاص بك',
    stepTranslateLabel: 'ترجمة',
    stepTranslateDesc: 'نترجم المستند مع الحفاظ على التخطيط',
    stepDownloadLabel: 'تنزيل',
    stepDownloadDesc: 'نزّل ملف PDF المترجم',
    editSubtitle: 'عدّل ملفات PDF بسهولة',
    stepEditLabel: 'تعديل',
    stepEditDesc: 'عدّل النص والتخطيط والخطوط',
    compatibilityChecking: 'جارٍ التحقق من توافق المتصفح…',
    compatibilityBlockedTitle: 'استخدم Lingadoo على Chrome أو Edge على الكمبيوتر',
    compatibilityBlockedIntro: 'يدعم Lingadoo حالياً Google Chrome وMicrosoft Edge على أجهزة الكمبيوتر فقط.',
    compatibilityLimitedTitle: 'بعض الميزات المحلية غير متاحة',
    compatibilityLimitedIntro: 'لا يزال بإمكان Lingadoo فتح المستندات محلياً، لكن بعض الميزات ستكون محدودة.',
  },
  fr: {
    code: 'fr',
    dir: 'ltr',
    path: '/fr',
    title: 'Lingadoo',
    subtitle: 'La traduction PDF en toute simplicité',
    dropZoneText: 'Déposez un PDF ici',
    dropZoneBrowse: 'ou cliquez pour parcourir',
    stepUploadLabel: 'Importer',
    stepUploadDesc: 'Importez votre document PDF',
    stepTranslateLabel: 'Traduire',
    stepTranslateDesc: 'Nous traduisons tout en préservant la mise en page',
    stepDownloadLabel: 'Télécharger',
    stepDownloadDesc: 'Récupérez le PDF traduit',
    editSubtitle: 'Éditez votre PDF facilement',
    stepEditLabel: 'Éditer',
    stepEditDesc: 'Ajustez le texte, la mise en page et les polices',
    compatibilityChecking: 'Vérification de la compatibilité du navigateur…',
    compatibilityBlockedTitle: 'Utilisez Lingadoo dans Chrome ou Edge sur ordinateur',
    compatibilityBlockedIntro: 'Lingadoo prend actuellement en charge uniquement Google Chrome et Microsoft Edge sur ordinateur.',
    compatibilityLimitedTitle: 'Certaines fonctions locales sont indisponibles',
    compatibilityLimitedIntro: 'Lingadoo peut toujours ouvrir des documents en local, mais certaines fonctions seront limitées.',
  },
  de: {
    code: 'de',
    dir: 'ltr',
    path: '/de',
    title: 'Lingadoo',
    subtitle: 'PDF-Übersetzung einfach gemacht',
    dropZoneText: 'PDF hier ablegen',
    dropZoneBrowse: 'oder zum Auswählen klicken',
    stepUploadLabel: 'Hochladen',
    stepUploadDesc: 'Laden Sie Ihr PDF-Dokument hoch',
    stepTranslateLabel: 'Übersetzen',
    stepTranslateDesc: 'Wir übersetzen und erhalten das Layout',
    stepDownloadLabel: 'Herunterladen',
    stepDownloadDesc: 'Erhalten Sie das übersetzte PDF',
    editSubtitle: 'PDF einfach bearbeiten',
    stepEditLabel: 'Bearbeiten',
    stepEditDesc: 'Text, Layout und Schriften anpassen',
    compatibilityChecking: 'Browser-Kompatibilität wird geprüft…',
    compatibilityBlockedTitle: 'Verwenden Sie Lingadoo in Chrome oder Edge auf dem Desktop',
    compatibilityBlockedIntro: 'Lingadoo unterstützt derzeit nur Google Chrome und Microsoft Edge auf Desktop-Computern.',
    compatibilityLimitedTitle: 'Einige lokale Funktionen sind nicht verfügbar',
    compatibilityLimitedIntro: 'Lingadoo kann Dokumente weiterhin lokal öffnen, aber einige Funktionen sind eingeschränkt.',
  },
  it: {
    code: 'it',
    dir: 'ltr',
    path: '/it',
    title: 'Lingadoo',
    subtitle: 'Traduzione PDF semplice e precisa',
    dropZoneText: 'Trascina qui un PDF',
    dropZoneBrowse: 'oppure fai clic per sfogliare',
    stepUploadLabel: 'Carica',
    stepUploadDesc: 'Carica il tuo documento PDF',
    stepTranslateLabel: 'Traduci',
    stepTranslateDesc: 'Traduciamo mantenendo il layout',
    stepDownloadLabel: 'Scarica',
    stepDownloadDesc: 'Ottieni il PDF tradotto',
    editSubtitle: 'Modifica il tuo PDF con facilità',
    stepEditLabel: 'Modifica',
    stepEditDesc: 'Regola testo, layout e font',
    compatibilityChecking: 'Verifica della compatibilità del browser…',
    compatibilityBlockedTitle: 'Usa Lingadoo in Chrome o Edge su desktop',
    compatibilityBlockedIntro: 'Al momento Lingadoo supporta solo Google Chrome e Microsoft Edge su computer desktop.',
    compatibilityLimitedTitle: 'Alcune funzioni locali non sono disponibili',
    compatibilityLimitedIntro: 'Lingadoo può comunque aprire i documenti localmente, ma alcune funzioni saranno limitate.',
  },
};

export function normalizeHomeLocale(value: string | null | undefined): SupportedLocale {
  const candidate = String(value || '').trim().toLowerCase();
  if (candidate === 'he' || candidate === 'ar' || candidate === 'fr' || candidate === 'de' || candidate === 'it') {
    return candidate;
  }
  return 'en';
}

export function normalizeBasePath(basePath: string | null | undefined): string {
  const trimmed = String(basePath || '/').trim();
  if (!trimmed || trimmed === '/') {
    return '/';
  }
  return `/${trimmed.replace(/^\/+|\/+$/g, '')}/`;
}

export function appPathFromLocationPath(pathname: string, basePath: string | null | undefined = '/'): string {
  const normalizedPathname = String(pathname || '/').trim() || '/';
  const withLeadingSlash = normalizedPathname.startsWith('/') ? normalizedPathname : `/${normalizedPathname}`;
  const normalizedBasePath = normalizeBasePath(basePath);
  if (normalizedBasePath === '/') {
    return withLeadingSlash;
  }
  const baseWithoutTrailingSlash = normalizedBasePath.slice(0, -1);
  if (withLeadingSlash === baseWithoutTrailingSlash) {
    return '/';
  }
  if (withLeadingSlash.startsWith(normalizedBasePath)) {
    return withLeadingSlash.slice(normalizedBasePath.length - 1) || '/';
  }
  return withLeadingSlash;
}

export function localeFromPath(pathname: string): SupportedLocale {
  const trimmed = String(pathname || '/').replace(/\/+$/, '') || '/';
  if (trimmed === '/') {
    return 'en';
  }
  const segments = trimmed.split('/').filter(Boolean);
  if (segments[0] === 'edit') {
    return normalizeHomeLocale(segments[1] || '');
  }
  return normalizeHomeLocale(segments[0] || '');
}

export function pathForLocale(locale: SupportedLocale): string {
  return HOME_LOCALES[locale].path;
}

export type AppMode = 'translate' | 'edit';

export function appModeFromPath(pathname: string): AppMode {
  const trimmed = String(pathname || '/').replace(/\/+$/, '') || '/';
  const firstSegment = trimmed.split('/')[1] || '';
  return firstSegment === 'edit' ? 'edit' : 'translate';
}

const COMPATIBILITY_ISSUE_COPY: Record<SupportedLocale, Record<string, CompatibilityIssueCopy>> = {
  en: {
    worker: {
      label: 'Module workers',
      detail: 'Lingadoo needs module workers to run locally.',
    },
    webassembly: {
      label: 'WebAssembly',
      detail: 'Lingadoo needs WebAssembly to load the PDF engine in the browser.',
    },
    'blob-url': {
      label: 'Blob URLs',
      detail: 'Lingadoo needs Blob and URL.createObjectURL support to show previews and download PDFs.',
    },
    'worker-startup': {
      label: 'Browser worker startup',
      detail: 'Lingadoo could not start its local browser runtime.',
    },
    'mupdf-wasm': {
      label: 'PDF engine runtime',
      detail: 'Lingadoo could not load the local PDF engine.',
    },
    'preview-canvas': {
      label: 'Preview rendering',
      detail: 'Lingadoo needs modern canvas APIs to render local page previews.',
    },
    'translator-api': {
      label: 'Supported browsers',
      detail: 'Lingadoo currently works only in Google Chrome and Microsoft Edge on desktop.',
    },
    'worker-fetch': {
      label: 'PDF export fonts',
      detail: 'This browser cannot load local export fonts, so PDF download may fail.',
    },
  },
  he: {
    worker: {
      label: 'עובדי דפדפן',
      detail: 'Lingadoo צריך תמיכה ב־module workers כדי לפעול מקומית.',
    },
    webassembly: {
      label: 'WebAssembly',
      detail: 'Lingadoo צריך WebAssembly כדי לטעון את מנוע ה־PDF בדפדפן.',
    },
    'blob-url': {
      label: 'כתובות Blob',
      detail: 'Lingadoo צריך תמיכה ב־Blob וב־URL.createObjectURL כדי להציג תצוגות מקדימות ולהוריד PDF.',
    },
    'worker-startup': {
      label: 'הפעלת עובד הדפדפן',
      detail: 'Lingadoo לא הצליח להפעיל את סביבת העבודה המקומית בדפדפן.',
    },
    'mupdf-wasm': {
      label: 'מנוע ה־PDF',
      detail: 'Lingadoo לא הצליח לטעון את מנוע ה־PDF המקומי.',
    },
    'preview-canvas': {
      label: 'תצוגה מקדימה',
      detail: 'Lingadoo צריך ממשקי canvas מודרניים כדי להציג תצוגות מקדימות מקומיות.',
    },
    'translator-api': {
      label: 'דפדפנים נתמכים',
      detail: 'כרגע Lingadoo עובד רק ב־Google Chrome וב־Microsoft Edge במחשב.',
    },
    'worker-fetch': {
      label: 'פונטים לייצוא PDF',
      detail: 'הדפדפן הזה לא מצליח לטעון פונטים מקומיים לייצוא, ולכן הורדת PDF עלולה להיכשל.',
    },
  },
  ar: {
    worker: {
      label: 'عمّال المتصفح',
      detail: 'يحتاج Lingadoo إلى module workers للعمل محلياً.',
    },
    webassembly: {
      label: 'WebAssembly',
      detail: 'يحتاج Lingadoo إلى WebAssembly لتحميل محرّك PDF داخل المتصفح.',
    },
    'blob-url': {
      label: 'عناوين Blob',
      detail: 'يحتاج Lingadoo إلى Blob و URL.createObjectURL لعرض المعاينات وتنزيل ملفات PDF.',
    },
    'worker-startup': {
      label: 'تشغيل عامل المتصفح',
      detail: 'تعذّر على Lingadoo تشغيل بيئة المتصفح المحلية.',
    },
    'mupdf-wasm': {
      label: 'محرّك PDF',
      detail: 'تعذّر على Lingadoo تحميل محرّك PDF المحلي.',
    },
    'preview-canvas': {
      label: 'معاينة الصفحات',
      detail: 'يحتاج Lingadoo إلى واجهات canvas حديثة لعرض معاينات الصفحات محلياً.',
    },
    'translator-api': {
      label: 'المتصفحات المدعومة',
      detail: 'يعمل Lingadoo حالياً فقط على Google Chrome وMicrosoft Edge على أجهزة الكمبيوتر.',
    },
    'worker-fetch': {
      label: 'خطوط تصدير PDF',
      detail: 'هذا المتصفح لا يستطيع تحميل خطوط التصدير المحلية، لذلك قد يفشل تنزيل PDF.',
    },
  },
  fr: {
    worker: {
      label: 'Workers du navigateur',
      detail: 'Lingadoo a besoin des module workers pour fonctionner en local.',
    },
    webassembly: {
      label: 'WebAssembly',
      detail: 'Lingadoo a besoin de WebAssembly pour charger le moteur PDF dans le navigateur.',
    },
    'blob-url': {
      label: 'URLs Blob',
      detail: 'Lingadoo a besoin de Blob et de URL.createObjectURL pour afficher les aperçus et télécharger les PDF.',
    },
    'worker-startup': {
      label: 'Démarrage du worker',
      detail: 'Lingadoo n’a pas pu démarrer son environnement local dans le navigateur.',
    },
    'mupdf-wasm': {
      label: 'Moteur PDF',
      detail: 'Lingadoo n’a pas pu charger le moteur PDF local.',
    },
    'preview-canvas': {
      label: 'Aperçu des pages',
      detail: 'Lingadoo a besoin d’API canvas modernes pour générer les aperçus locaux.',
    },
    'translator-api': {
      label: 'Navigateurs pris en charge',
      detail: 'Lingadoo fonctionne actuellement uniquement dans Google Chrome et Microsoft Edge sur ordinateur.',
    },
    'worker-fetch': {
      label: 'Polices d’export PDF',
      detail: 'Ce navigateur ne peut pas charger les polices d’export locales, le téléchargement PDF peut donc échouer.',
    },
  },
  de: {
    worker: {
      label: 'Browser-Worker',
      detail: 'Lingadoo benötigt Module Worker, um lokal zu laufen.',
    },
    webassembly: {
      label: 'WebAssembly',
      detail: 'Lingadoo benötigt WebAssembly, um die PDF-Engine im Browser zu laden.',
    },
    'blob-url': {
      label: 'Blob-URLs',
      detail: 'Lingadoo benötigt Blob und URL.createObjectURL, um Vorschauen anzuzeigen und PDFs herunterzuladen.',
    },
    'worker-startup': {
      label: 'Browser-Worker-Start',
      detail: 'Lingadoo konnte die lokale Browser-Laufzeit nicht starten.',
    },
    'mupdf-wasm': {
      label: 'PDF-Engine',
      detail: 'Lingadoo konnte die lokale PDF-Engine nicht laden.',
    },
    'preview-canvas': {
      label: 'Seitenvorschau',
      detail: 'Lingadoo benötigt moderne Canvas-APIs, um lokale Seitenvorschauen zu rendern.',
    },
    'translator-api': {
      label: 'Unterstützte Browser',
      detail: 'Lingadoo funktioniert derzeit nur in Google Chrome und Microsoft Edge auf Desktop-Computern.',
    },
    'worker-fetch': {
      label: 'PDF-Export-Schriften',
      detail: 'Dieser Browser kann lokale Export-Schriften nicht laden, daher kann der PDF-Download fehlschlagen.',
    },
  },
  it: {
    worker: {
      label: 'Worker del browser',
      detail: 'Lingadoo richiede i module worker per funzionare in locale.',
    },
    webassembly: {
      label: 'WebAssembly',
      detail: 'Lingadoo richiede WebAssembly per caricare il motore PDF nel browser.',
    },
    'blob-url': {
      label: 'URL Blob',
      detail: 'Lingadoo richiede Blob e URL.createObjectURL per mostrare le anteprime e scaricare i PDF.',
    },
    'worker-startup': {
      label: 'Avvio del worker',
      detail: 'Lingadoo non è riuscito ad avviare l’ambiente locale del browser.',
    },
    'mupdf-wasm': {
      label: 'Motore PDF',
      detail: 'Lingadoo non è riuscito a caricare il motore PDF locale.',
    },
    'preview-canvas': {
      label: 'Anteprima pagine',
      detail: 'Lingadoo richiede API canvas moderne per renderizzare le anteprime locali.',
    },
    'translator-api': {
      label: 'Browser supportati',
      detail: 'Lingadoo attualmente funziona solo in Google Chrome e Microsoft Edge su desktop.',
    },
    'worker-fetch': {
      label: 'Font per export PDF',
      detail: 'Questo browser non riesce a caricare i font locali per l’esportazione, quindi il download del PDF potrebbe non riuscire.',
    },
  },
};

export function localizeCompatibilityIssue(
  locale: SupportedLocale,
  issue: { key: string; label: string; detail: string },
): CompatibilityIssueCopy {
  return COMPATIBILITY_ISSUE_COPY[locale]?.[issue.key] || {
    label: issue.label,
    detail: issue.detail,
  };
}
