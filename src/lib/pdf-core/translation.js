export const STAGE_TRANSLATIONS = 'translations';
export const SCHEMA_VERSION = '1.0';

import {
  containsSourceScript,
  getDocumentLanguage,
  normalizeDocumentLanguageCode,
} from './documentLanguages.js';
import {
  logBrowserTranslationRequestFailed,
  logBrowserTranslationRequestStarted,
  logBrowserTranslationRequestSucceeded,
} from '../browserTranslationInspection.js';

const DATE_PATTERN = /\b(?:\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}[./-]\d{1,2}[./-]\d{1,2})\b/gu;
const NUMBER_PATTERN = /\d[\d,./:-]*/gu;
const BULLET_LINE_PATTERN = /^\s*[-*•·]\s+/gmu;
const HEBREW_LETTER_PATTERN = /[\u05D0-\u05EA]/u;
const RTL_LABEL_WITH_OPTIONAL_LEADING_COLON_RE = /^\s*:?\s*([\u0590-\u08FF][\u0590-\u08FF\s"'()./\-]+?)\s*:?\s*$/u;
const RTL_LABEL_VALUE_START_RE = /[A-Za-z0-9@(+]/u;
const SHEKEL_AMOUNT_ONLY_PATTERN = /^\s*(?:(?<prefix>ש["״”]?ח|₪)\s*(?<amount_prefix>[+-]?\d[\d,]*(?:\.\d+)?)|(?<amount_suffix>[+-]?\d[\d,]*(?:\.\d+)?)\s*(?<suffix>ש["״”]?ח|₪))\s*$/u;
const DEFAULT_BROWSER_TRANSLATOR_TIMEOUT_MS = 3000;
const DEFAULT_BROWSER_TRANSLATOR_DOWNLOAD_TIMEOUT_MS = 120_000;

export const TranslationStatus = {
  CACHED: 'cached',
  TRANSLATED: 'translated',
  RETRIED_STRICT: 'retried_strict',
  FALLBACK: 'fallback',
};

export const TranslationIssue = {
  LENGTH_RATIO_EXTREME: 'length_ratio_extreme',
  MISSING_NUMBERS: 'missing_numbers',
  ALTERED_DATES: 'altered_dates',
  MISSING_PARENTHESES: 'missing_parentheses',
  DROPPED_BULLET_MARKERS: 'dropped_bullet_markers',
  UNCHANGED_SOURCE_TEXT: 'unchanged_source_text',
};

export class TranslationDependencyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TranslationDependencyError';
  }
}

export class IdentityFallbackTranslator {
  translate(text) {
    return text;
  }
}

export class BrowserTranslatorProvider {
  constructor({
    sourceLang = null,
    sourceCode = 'he',
    targetLang = null,
    targetCode = 'en',
    timeoutMs = DEFAULT_BROWSER_TRANSLATOR_TIMEOUT_MS,
    TranslatorImpl = globalThis.Translator,
  } = {}) {
    this.sourceCode = normalizeDocumentLanguageCode(sourceCode, 'he');
    this.targetCode = normalizeDocumentLanguageCode(targetCode, 'en');
    this.sourceLang = sourceLang || getDocumentLanguage(this.sourceCode).name;
    this.targetLang = targetLang || getDocumentLanguage(this.targetCode).name;
    this.timeoutMs = Number(timeoutMs) || DEFAULT_BROWSER_TRANSLATOR_TIMEOUT_MS;
    this.TranslatorImpl = TranslatorImpl;
    this._translatorPromise = null;
    this._createTimeoutMs = null;
    this._cachedAvailability = null;
  }

  static isSupported(TranslatorImpl = globalThis.Translator) {
    return Boolean(
      TranslatorImpl
      && typeof TranslatorImpl.availability === 'function'
      && typeof TranslatorImpl.create === 'function',
    );
  }

  async checkAvailability() {
    if (!BrowserTranslatorProvider.isSupported(this.TranslatorImpl)) {
      this._cachedAvailability = 'unavailable';
      return 'unavailable';
    }
    try {
      const result = await this._withTimeout(
        this.TranslatorImpl.availability({
          sourceLanguage: this.sourceCode,
          targetLanguage: this.targetCode,
        }),
        'availability',
      );
      this._cachedAvailability = result;
      return result;
    } catch {
      this._cachedAvailability = 'unavailable';
      return 'unavailable';
    }
  }

  setCreateTimeout(ms) {
    this._createTimeoutMs = Number(ms) || DEFAULT_BROWSER_TRANSLATOR_DOWNLOAD_TIMEOUT_MS;
  }

  async ensureReady() {
    return this._ensureTranslator();
  }

  async _withTimeout(promise, label) {
    const timeoutMs = Number(this.timeoutMs) || DEFAULT_BROWSER_TRANSLATOR_TIMEOUT_MS;
    if (!(timeoutMs > 0)) {
      return promise;
    }
    let timeoutId = null;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(new TranslationDependencyError(`Browser Translator API ${label} timed out after ${timeoutMs}ms`));
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
    }
  }

  async _ensureTranslator() {
    if (!BrowserTranslatorProvider.isSupported(this.TranslatorImpl)) {
      throw new TranslationDependencyError('Browser Translator API is not available');
    }
    if (this._translatorPromise === null) {
      this._translatorPromise = (async () => {
        const availability = this._cachedAvailability || await this._withTimeout(
          this.TranslatorImpl.availability({
            sourceLanguage: this.sourceCode,
            targetLanguage: this.targetCode,
          }),
          'availability',
        );
        if (availability === 'unavailable') {
          throw new TranslationDependencyError(
            `Browser Translator API does not support ${this.sourceCode} -> ${this.targetCode}`,
          );
        }
        const createTimeoutMs = this._createTimeoutMs || this.timeoutMs;
        const createTimeoutLabel = this._createTimeoutMs
          ? 'initialization (download)'
          : 'initialization';
        let createTimeoutId = null;
        try {
          return await Promise.race([
            this.TranslatorImpl.create({
              sourceLanguage: this.sourceCode,
              targetLanguage: this.targetCode,
            }),
            new Promise((_, reject) => {
              createTimeoutId = setTimeout(() => {
                reject(new TranslationDependencyError(
                  `Browser Translator API ${createTimeoutLabel} timed out after ${createTimeoutMs}ms`,
                ));
              }, Number(createTimeoutMs) || DEFAULT_BROWSER_TRANSLATOR_TIMEOUT_MS);
            }),
          ]);
        } finally {
          if (createTimeoutId !== null) {
            clearTimeout(createTimeoutId);
          }
        }
      })();
    }
    return this._translatorPromise;
  }

  async translate(text) {
    const translator = await this._ensureTranslator();
    const translated = await this._withTimeout(
      translator.translate(String(text || '')),
      'translation',
    );
    const candidate = String(translated || '').trim();
    if (!candidate) {
      throw new TranslationDependencyError('Browser Translator API returned empty translation response');
    }
    return candidate;
  }

  async destroy() {
    if (this._translatorPromise === null) {
      return;
    }
    try {
      const translator = await this._translatorPromise.catch(() => null);
      if (translator && typeof translator.destroy === 'function') {
        translator.destroy();
      }
    } finally {
      this._translatorPromise = null;
    }
  }
}

export class InMemoryTranslationMemory {
  constructor(values = {}) {
    this.values = { ...values };
  }

  get(key) {
    return this.values[key] ?? null;
  }

  set(key, value) {
    this.values[key] = value;
  }

  toJSON() {
    return { ...this.values };
  }
}

function normalizeText(text) {
  return String(text || '').split(/\s+/u).filter(Boolean).join(' ');
}

function containsSourceLanguageLetters(text, sourceCode) {
  return containsSourceScript(text, sourceCode);
}

function sourceDirection(text) {
  let rtlCount = 0;
  let ltrCount = 0;
  for (const char of String(text || '')) {
    if (char >= '\u0590' && char <= '\u08FF') {
      rtlCount += 1;
    } else if ((char >= 'A' && char <= 'Z') || (char >= 'a' && char <= 'z')) {
      ltrCount += 1;
    }
  }
  if (rtlCount === 0 && ltrCount === 0) {
    return 'UNKNOWN';
  }
  return rtlCount >= ltrCount ? 'RTL' : 'LTR';
}

function targetDirection(targetCode) {
  const normalized = String(targetCode || '').trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  return new Set(['ar', 'fa', 'he', 'iw', 'ur']).has(normalized) ? 'RTL' : 'LTR';
}

function normalizeCandidateLineBreaks(sourceText, candidateText, { blockType }) {
  const normalized = String(candidateText || '').trim();
  if (!normalized.includes('\n')) {
    return normalized;
  }
  if (String(sourceText || '').includes('\n')) {
    return normalized;
  }
  if (blockType === 'list' || blockType === 'table_cell') {
    return normalized;
  }
  return normalized.split(/\r?\n/u).map((part) => part.trim()).filter(Boolean).join(' ').trim();
}

function deterministicCurrencyTranslation(text) {
  const matched = SHEKEL_AMOUNT_ONLY_PATTERN.exec(String(text || ''));
  if (!matched) {
    return null;
  }
  const amount = matched.groups?.amount_prefix || matched.groups?.amount_suffix;
  if (!amount) {
    return null;
  }
  return `NIS ${amount}`;
}

function normalizedRtlLabelSourceLine(text) {
  const normalized = String(text || '').trim();
  if (!normalized) {
    return null;
  }
  if (normalized.includes(':')) {
    const match = RTL_LABEL_WITH_OPTIONAL_LEADING_COLON_RE.exec(normalized);
    if (match) {
      const label = match[1].split(/\s+/u).filter(Boolean).join(' ');
      if (!label) {
        return null;
      }
      return `${label}:`;
    }
  }
  if (!normalized.startsWith(':')) {
    return null;
  }
  const payload = normalized.slice(1).trim();
  if (!payload || !HEBREW_LETTER_PATTERN.test(payload)) {
    return null;
  }
  const valueMatch = RTL_LABEL_VALUE_START_RE.exec(payload);
  if (!valueMatch) {
    return null;
  }
  const label = payload.slice(0, valueMatch.index).split(/\s+/u).filter(Boolean).join(' ');
  const value = payload.slice(valueMatch.index).trim();
  if (!label || !value || !HEBREW_LETTER_PATTERN.test(label)) {
    return null;
  }
  return `${label}: ${value}`;
}

function normalizedRtlLabelSource(text) {
  const lines = String(text || '').split(/\r?\n/u);
  let changed = false;
  const normalizedLines = lines.map((line) => {
    const normalized = normalizedRtlLabelSourceLine(line);
    if (normalized === null) {
      return line;
    }
    changed = changed || normalized !== line;
    return normalized;
  });
  if (normalizedLines.length === 0 || !changed) {
    return null;
  }
  return normalizedLines.length === 1 ? normalizedLines[0] : normalizedLines.join('\n');
}

function normalizeTranslatedLabelColonOrder(sourceText, candidateText, { targetCode }) {
  if (targetDirection(targetCode) !== 'LTR') {
    return candidateText;
  }

  const normalizeLine = (sourceLine, candidateLine) => {
    const sourceNormalized = normalizedRtlLabelSourceLine(sourceLine);
    let normalized = String(candidateLine || '').trim();
    if (sourceNormalized === null || !normalized) {
      return normalized;
    }
    if (normalized.startsWith(':')) {
      normalized = normalized.slice(1).trimStart();
    }
    if (sourceNormalized.endsWith(':') && !sourceNormalized.includes(': ')) {
      if (!normalized.includes(':')) {
        return `${normalized.replace(/:+$/u, '').trim()}:`;
      }
      return normalized.replace(/\s+:\s*$/u, ':');
    }
    return normalized;
  };

  const sourceLines = String(sourceText || '').split(/\r?\n/u);
  const candidateLines = String(candidateText || '').split(/\r?\n/u);
  if (sourceLines.length === candidateLines.length && candidateLines.length > 0) {
    return candidateLines.map((line, index) => normalizeLine(sourceLines[index], line)).join('\n');
  }
  return normalizeLine(sourceText, candidateText);
}

function enforceSourceDates(sourceText, candidateText) {
  const sourceDates = [...String(sourceText || '').matchAll(DATE_PATTERN)].map((match) => match[0]);
  if (sourceDates.length === 0) {
    return candidateText;
  }
  const targetDates = [...String(candidateText || '').matchAll(DATE_PATTERN)].map((match) => match[0]);
  if (targetDates.length === 0) {
    return candidateText;
  }
  let sourceIndex = 0;
  return String(candidateText || '').replace(DATE_PATTERN, (match) => {
    if (sourceIndex >= sourceDates.length) {
      return match;
    }
    const replacement = sourceDates[sourceIndex];
    sourceIndex += 1;
    return replacement;
  });
}

function normalizeNumberToken(token) {
  return String(token || '')
    .trim()
    .replace(/^([([{\u05f4\u05f3"'])+/u, '')
    .replace(/([)\]},;:!?"'\u05c3])+$/u, '')
    .replace(/\.$/u, '');
}

function missingNumbers(source, target) {
  const sourceNumbers = new Set(
    [...String(source || '').matchAll(NUMBER_PATTERN)]
      .map((match) => normalizeNumberToken(match[0]))
      .filter(Boolean),
  );
  if (sourceNumbers.size === 0) {
    return false;
  }
  const targetNumbers = new Set(
    [...String(target || '').matchAll(NUMBER_PATTERN)]
      .map((match) => normalizeNumberToken(match[0]))
      .filter(Boolean),
  );
  for (const number of sourceNumbers) {
    if (!targetNumbers.has(number)) {
      return true;
    }
  }
  return false;
}

function alteredDates(source, target) {
  const sourceDates = new Set([...String(source || '').matchAll(DATE_PATTERN)].map((match) => match[0]));
  if (sourceDates.size === 0) {
    return false;
  }
  const targetDates = new Set([...String(target || '').matchAll(DATE_PATTERN)].map((match) => match[0]));
  for (const date of sourceDates) {
    if (!targetDates.has(date)) {
      return true;
    }
  }
  return false;
}

function missingParentheses(source, target) {
  for (const [left, right] of [['(', ')'], ['[', ']'], ['{', '}']]) {
    if (String(source || '').split(left).length > String(target || '').split(left).length) {
      return true;
    }
    if (String(source || '').split(right).length > String(target || '').split(right).length) {
      return true;
    }
  }
  return false;
}

function droppedBullets(source, target) {
  const sourceCount = [...String(source || '').matchAll(BULLET_LINE_PATTERN)].length;
  if (sourceCount === 0) {
    return false;
  }
  const targetCount = [...String(target || '').matchAll(BULLET_LINE_PATTERN)].length;
  return targetCount < sourceCount;
}

export function validateTranslation(sourceText, translatedText, { targetCode = null } = {}) {
  const issues = [];
  const normalizedSource = normalizeText(sourceText);
  const normalizedTarget = normalizeText(translatedText);

  if (normalizedSource.length >= 20) {
    const ratio = normalizedTarget.length / Math.max(1, normalizedSource.length);
    if (ratio < 0.55 || ratio > 3.5) {
      issues.push(TranslationIssue.LENGTH_RATIO_EXTREME);
    }
  }
  if (missingNumbers(sourceText, translatedText)) {
    issues.push(TranslationIssue.MISSING_NUMBERS);
  }
  if (alteredDates(sourceText, translatedText)) {
    issues.push(TranslationIssue.ALTERED_DATES);
  }
  if (missingParentheses(sourceText, translatedText)) {
    issues.push(TranslationIssue.MISSING_PARENTHESES);
  }
  if (droppedBullets(sourceText, translatedText)) {
    issues.push(TranslationIssue.DROPPED_BULLET_MARKERS);
  }
  if (targetCode !== null && normalizedSource === normalizedTarget) {
    const expectedDirection = targetDirection(targetCode);
    const sourceDir = sourceDirection(sourceText);
    if (expectedDirection !== null && sourceDir !== 'UNKNOWN' && sourceDir !== expectedDirection) {
      issues.push(TranslationIssue.UNCHANGED_SOURCE_TEXT);
    }
  }
  return issues;
}

function mergeIssues(...issueLists) {
  const ordered = [];
  const seen = new Set();
  for (const issueList of issueLists) {
    for (const issue of issueList) {
      if (seen.has(issue)) {
        continue;
      }
      seen.add(issue);
      ordered.push(issue);
    }
  }
  return ordered;
}

export async function translationHash(sourceText, {
  modelVersion,
  glossaryVersion,
  promptVersion,
}) {
  const content = `${sourceText}\n${modelVersion}\n${glossaryVersion}\n${promptVersion}`;
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(content),
  );
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export async function translateBlock(block, {
  provider,
  fallback = new IdentityFallbackTranslator(),
  memory = new InMemoryTranslationMemory(),
  context,
}) {
  const key = await translationHash(block.text, {
    modelVersion: context.modelVersion,
    glossaryVersion: context.glossaryVersion,
    promptVersion: context.promptVersion,
  });

  const deterministicCandidate = deterministicCurrencyTranslation(block.text);
  if (deterministicCandidate !== null) {
    memory.set(key, deterministicCandidate);
    return {
      block_id: block.block_id,
      page_id: block.page_id,
      source_text: block.text,
      translated_text: deterministicCandidate,
      translation_hash: key,
      status: TranslationStatus.TRANSLATED,
      attempts: 1,
      issues: [],
    };
  }

  if (normalizeDocumentLanguageCode(context.sourceCode, 'he') === normalizeDocumentLanguageCode(context.targetCode, 'en')) {
    const passthroughText = normalizeCandidateLineBreaks(block.text, block.text, { blockType: block.type });
    memory.set(key, passthroughText);
    return {
      block_id: block.block_id,
      page_id: block.page_id,
      source_text: block.text,
      translated_text: passthroughText,
      translation_hash: key,
      status: TranslationStatus.TRANSLATED,
      attempts: 1,
      issues: [],
    };
  }

  if (!containsSourceLanguageLetters(block.text, context.sourceCode)) {
    const passthroughText = normalizeCandidateLineBreaks(block.text, block.text, { blockType: block.type });
    memory.set(key, passthroughText);
    return {
      block_id: block.block_id,
      page_id: block.page_id,
      source_text: block.text,
      translated_text: passthroughText,
      translation_hash: key,
      status: TranslationStatus.TRANSLATED,
      attempts: 1,
      issues: [],
    };
  }

  const cached = memory.get(key);
  if (cached !== null) {
    const normalizedCached = normalizeTranslatedLabelColonOrder(
      block.text,
      normalizeCandidateLineBreaks(block.text, cached, { blockType: block.type }),
      { targetCode: context.targetCode },
    );
    memory.set(key, normalizedCached);
    const cachedIssues = validateTranslation(block.text, normalizedCached, {
      targetCode: context.targetCode,
    });
    if (cachedIssues.length === 0) {
      return {
        block_id: block.block_id,
        page_id: block.page_id,
        source_text: block.text,
        translated_text: normalizedCached,
        translation_hash: key,
        status: TranslationStatus.CACHED,
        attempts: 1,
        issues: [],
      };
    }
  }

  const logicalSourceText = normalizedRtlLabelSource(block.text) || block.text;
  const protectedSourceText = logicalSourceText;
  const blockSourceDirection = sourceDirection(block.text);

  const normalizeCandidate = (candidateText) => {
    let candidate = String(candidateText || '');
    candidate = enforceSourceDates(block.text, candidate);
    candidate = normalizeCandidateLineBreaks(block.text, candidate, { blockType: block.type });
    candidate = normalizeTranslatedLabelColonOrder(block.text, candidate, { targetCode: context.targetCode });
    return candidate;
  };

  const translateWithInspection = async (text, strict) => {
    const entryId = provider instanceof BrowserTranslatorProvider
      ? logBrowserTranslationRequestStarted({
          sourceText: text,
          pageId: block.page_id,
          blockId: block.block_id,
          sourceCode: context.sourceCode,
          targetCode: context.targetCode,
          strict,
          blockType: block.type,
          sourceDirection: blockSourceDirection,
        })
      : null;
    try {
      const candidate = await provider.translate(text, {
        blockType: block.type,
        sourceDirection: blockSourceDirection,
        strict,
      });
      if (entryId) {
        logBrowserTranslationRequestSucceeded(entryId, candidate);
      }
      return candidate;
    } catch (error) {
      if (entryId) {
        logBrowserTranslationRequestFailed(entryId, error);
      }
      throw error;
    }
  };

  const defaultCandidate = normalizeCandidate(
    await translateWithInspection(protectedSourceText, false),
  );
  const defaultIssues = validateTranslation(block.text, defaultCandidate, {
    targetCode: context.targetCode,
  });
  if (defaultIssues.length === 0) {
    memory.set(key, defaultCandidate);
    return {
      block_id: block.block_id,
      page_id: block.page_id,
      source_text: block.text,
      translated_text: defaultCandidate,
      translation_hash: key,
      status: TranslationStatus.TRANSLATED,
      attempts: 1,
      issues: [],
    };
  }

  const strictCandidate = normalizeCandidate(
    await translateWithInspection(protectedSourceText, true),
  );
  const strictIssues = validateTranslation(block.text, strictCandidate, {
    targetCode: context.targetCode,
  });
  if (strictIssues.length === 0) {
    memory.set(key, strictCandidate);
    return {
      block_id: block.block_id,
      page_id: block.page_id,
      source_text: block.text,
      translated_text: strictCandidate,
      translation_hash: key,
      status: TranslationStatus.RETRIED_STRICT,
      attempts: 2,
      issues: defaultIssues,
    };
  }

  const fallbackCandidate = normalizeCandidate(fallback.translate(block.text));
  const fallbackIssues = validateTranslation(block.text, fallbackCandidate, {
    targetCode: context.targetCode,
  });
  if (
    fallbackIssues.includes(TranslationIssue.UNCHANGED_SOURCE_TEXT)
    && !strictIssues.includes(TranslationIssue.UNCHANGED_SOURCE_TEXT)
  ) {
    const mergedIssues = mergeIssues(defaultIssues, strictIssues);
    memory.set(key, strictCandidate);
    return {
      block_id: block.block_id,
      page_id: block.page_id,
      source_text: block.text,
      translated_text: strictCandidate,
      translation_hash: key,
      status: TranslationStatus.RETRIED_STRICT,
      attempts: 2,
      issues: mergedIssues,
    };
  }

  const mergedIssues = mergeIssues(defaultIssues, strictIssues, fallbackIssues);
  memory.set(key, fallbackCandidate);
  return {
    block_id: block.block_id,
    page_id: block.page_id,
    source_text: block.text,
    translated_text: fallbackCandidate,
    translation_hash: key,
    status: TranslationStatus.FALLBACK,
    attempts: 3,
    issues: mergedIssues,
  };
}

export async function translatePageLayout(layout, {
  provider,
  fallback = new IdentityFallbackTranslator(),
  memory = new InMemoryTranslationMemory(),
    context = {
      modelVersion: provider?.model || 'unknown',
      glossaryVersion: 'v1',
      promptVersion: 'v1',
      sourceCode: 'he',
      targetCode: 'en',
    },
}) {
  const orderedBlocks = [...layout.blocks].sort((left, right) => left.reading_order - right.reading_order);
  const translatedBlocks = [];
  for (const block of orderedBlocks) {
    translatedBlocks.push(await translateBlock(block, {
      provider,
      fallback,
      memory,
      context,
    }));
  }

  return {
    schema_version: SCHEMA_VERSION,
    stage: STAGE_TRANSLATIONS,
    document_id: layout.document_id,
    page_id: layout.page_id,
    model_version: context.modelVersion,
    glossary_version: context.glossaryVersion,
    prompt_version: context.promptVersion,
    blocks: translatedBlocks,
  };
}
