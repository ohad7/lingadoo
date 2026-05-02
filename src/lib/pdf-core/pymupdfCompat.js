export const PYMUPDF_TWIN_CONTRACT_VERSION = 'v1';

export const PYMUPDF_TWIN_STATUS = Object.freeze({
  NATIVE: 'native',
  EMULATED: 'emulated',
  BINDING_EXTENSION: 'binding_extension',
  OUT_OF_SCOPE: 'out_of_scope',
});

export const PYMUPDF_TWIN_AREA = Object.freeze({
  TEXT: 'text',
  VECTOR: 'vector',
  TABLES: 'tables',
  RENDER: 'render',
  PAGE: 'page',
});

export const PYMUPDF_TWIN_REQUIREMENTS = Object.freeze([
  Object.freeze({
    id: 'page-text-rawdict',
    area: PYMUPDF_TWIN_AREA.TEXT,
    pymupdf_api: 'page.get_text("rawdict")',
    js_contract: 'pageAdapter.getText("rawdict", options)',
    status: PYMUPDF_TWIN_STATUS.EMULATED,
    implementation_note: 'Build from StructuredText.walk() char/span aggregation with PyMuPDF-compatible rawdict blocks/lines/spans/chars.',
  }),
  Object.freeze({
    id: 'page-text-dict',
    area: PYMUPDF_TWIN_AREA.TEXT,
    pymupdf_api: 'page.get_text("dict")',
    js_contract: 'pageAdapter.getText("dict", options)',
    status: PYMUPDF_TWIN_STATUS.EMULATED,
    implementation_note: 'Derived from rawdict with PyMuPDF-compatible dict/span fields used by digital_stage and mirror_stage.',
  }),
  Object.freeze({
    id: 'page-text-words',
    area: PYMUPDF_TWIN_AREA.TEXT,
    pymupdf_api: 'page.get_text("words")',
    js_contract: 'pageAdapter.getText("words", options)',
    status: PYMUPDF_TWIN_STATUS.EMULATED,
    implementation_note: 'Build from StructuredText word walk with stable word tuple ordering and bbox rounding compatible with PyMuPDF consumers.',
  }),
  Object.freeze({
    id: 'page-get-textbox',
    area: PYMUPDF_TWIN_AREA.TEXT,
    pymupdf_api: 'page.get_textbox(rect)',
    js_contract: 'pageAdapter.getTextbox(rect, options)',
    status: PYMUPDF_TWIN_STATUS.EMULATED,
    implementation_note: 'Requires text clipping over a rect with PyMuPDF newline ordering semantics for table cells and headers.',
  }),
  Object.freeze({
    id: 'page-get-drawings',
    area: PYMUPDF_TWIN_AREA.VECTOR,
    pymupdf_api: 'page.get_drawings()',
    js_contract: 'pageAdapter.getDrawings(options)',
    status: PYMUPDF_TWIN_STATUS.EMULATED,
    implementation_note: 'Can be reconstructed from Device fill/stroke path callbacks into PyMuPDF-style path dicts.',
  }),
  Object.freeze({
    id: 'page-cluster-drawings',
    area: PYMUPDF_TWIN_AREA.VECTOR,
    pymupdf_api: 'page.cluster_drawings(drawings?)',
    js_contract: 'pageAdapter.clusterDrawings(options)',
    status: PYMUPDF_TWIN_STATUS.EMULATED,
    implementation_note: 'Pure geometry clustering over getDrawings()-compatible output.',
  }),
  Object.freeze({
    id: 'page-find-tables-python-shell',
    area: PYMUPDF_TWIN_AREA.TABLES,
    pymupdf_api: 'page.find_tables(...) Python orchestration',
    js_contract: 'pageAdapter.findTables(options)',
    status: PYMUPDF_TWIN_STATUS.EMULATED,
    implementation_note: 'Most of table.py can be ported to JS once getText/rawdict/getDrawings/getTextbox contracts exist.',
  }),
  Object.freeze({
    id: 'page-find-tables-core-detector',
    area: PYMUPDF_TWIN_AREA.TABLES,
    pymupdf_api: 'pymupdf.extra.make_table_dict / fz_find_table_within_bounds',
    js_contract: 'pageAdapter.findTables(options).coreDetector',
    status: PYMUPDF_TWIN_STATUS.NATIVE,
    implementation_note: 'Provided by the local MuPDF.js fork via wasm_find_table_within_bounds_as_json backed by fz_find_table_within_bounds.',
  }),
  Object.freeze({
    id: 'page-get-images',
    area: PYMUPDF_TWIN_AREA.PAGE,
    pymupdf_api: 'page.get_images(full=True) + page.get_image_rects(xref)',
    js_contract: 'pageAdapter.getImageResources()',
    status: PYMUPDF_TWIN_STATUS.EMULATED,
    implementation_note: 'Enumerate PDF image XObjects through page resources; pair with getImageBlocks() placement filtering for PyMuPDF-style image counting and page typing.',
  }),
  Object.freeze({
    id: 'page-get-layout',
    area: PYMUPDF_TWIN_AREA.PAGE,
    pymupdf_api: 'page.get_layout() / page.layout_information',
    js_contract: 'pageAdapter.getLayoutInfo()',
    status: PYMUPDF_TWIN_STATUS.EMULATED,
    implementation_note: 'Expose heuristic layout_information entries derived from emulated findTables() regions.',
  }),
  Object.freeze({
    id: 'page-render-display-list',
    area: PYMUPDF_TWIN_AREA.RENDER,
    pymupdf_api: 'page.get_pixmap() / display list rendering',
    js_contract: 'pageAdapter.toDisplayList() / pageAdapter.toPixmap(options)',
    status: PYMUPDF_TWIN_STATUS.NATIVE,
    implementation_note: 'Already provided by MuPDF.js Page/DisplayList/Pixmap APIs.',
  }),
]);

export const PYMUPDF_TWIN_CONTRACT = Object.freeze({
  version: PYMUPDF_TWIN_CONTRACT_VERSION,
  requiredPageMethods: Object.freeze([
    'getText',
    'getTextbox',
    'getDrawings',
    'getImageResources',
    'clusterDrawings',
    'findTables',
    'toDisplayList',
    'toStructuredText',
    'toPixmap',
  ]),
  requiredDocumentMethods: Object.freeze([
    'countPages',
    'loadPage',
  ]),
  requirements: PYMUPDF_TWIN_REQUIREMENTS,
});

export function requirementById(requirementId) {
  return PYMUPDF_TWIN_REQUIREMENTS.find((item) => item.id === requirementId) || null;
}

export function classifyRequirementStatusSummary() {
  const summary = {
    version: PYMUPDF_TWIN_CONTRACT_VERSION,
    total: PYMUPDF_TWIN_REQUIREMENTS.length,
    by_status: {},
    by_area: {},
  };
  for (const requirement of PYMUPDF_TWIN_REQUIREMENTS) {
    summary.by_status[requirement.status] = (summary.by_status[requirement.status] || 0) + 1;
    summary.by_area[requirement.area] = (summary.by_area[requirement.area] || 0) + 1;
  }
  return summary;
}

export function validatePyMuPdfTwinDocumentAdapter(adapter) {
  const missing = [];
  for (const methodName of PYMUPDF_TWIN_CONTRACT.requiredDocumentMethods) {
    if (!adapter || typeof adapter[methodName] !== 'function') {
      missing.push(methodName);
    }
  }
  return {
    ok: missing.length === 0,
    missing_methods: missing,
  };
}

export function validatePyMuPdfTwinPageAdapter(adapter) {
  const missing = [];
  for (const methodName of PYMUPDF_TWIN_CONTRACT.requiredPageMethods) {
    if (!adapter || typeof adapter[methodName] !== 'function') {
      missing.push(methodName);
    }
  }
  return {
    ok: missing.length === 0,
    missing_methods: missing,
  };
}

export function inspectMuPdfJsBaselineCapabilities(mupdf) {
  const exportedKeys = Object.keys(mupdf || {});
  const hasExport = (name) => exportedKeys.includes(name);
  return {
    version: PYMUPDF_TWIN_CONTRACT_VERSION,
    exports: {
      Document: hasExport('Document'),
      DisplayList: hasExport('DisplayList'),
      StructuredText: hasExport('StructuredText'),
      Device: hasExport('Device'),
      Pixmap: hasExport('Pixmap'),
      Rect: hasExport('Rect'),
      Matrix: hasExport('Matrix'),
    },
    supports_native_render_path: hasExport('DisplayList') && hasExport('Pixmap'),
    supports_structured_text_walk: hasExport('StructuredText'),
  };
}
