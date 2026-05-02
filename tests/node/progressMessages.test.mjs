import assert from 'node:assert/strict';
import test from 'node:test';

import {
  STAGES,
  PROGRESS_MESSAGES,
  WORKING_HARDER_MESSAGES,
  phaseToStage,
  getProgressMessage,
} from '../../src/lib/progressMessages.js';

test('STAGES contains exactly four stage keys', () => {
  assert.deepEqual([...STAGES], ['reading', 'preparing', 'translating', 'finishing']);
});

test('PROGRESS_MESSAGES has all three tones', () => {
  assert.ok(PROGRESS_MESSAGES.calm);
  assert.ok(PROGRESS_MESSAGES.playful);
  assert.ok(PROGRESS_MESSAGES.silly);
});

test('each tone has all four stages with at least 10 messages each', () => {
  for (const tone of ['calm', 'playful', 'silly']) {
    for (const stage of STAGES) {
      const pool = PROGRESS_MESSAGES[tone][stage];
      assert.ok(Array.isArray(pool), `${tone}.${stage} should be an array`);
      assert.ok(pool.length >= 10, `${tone}.${stage} should have at least 10 messages, got ${pool.length}`);
    }
  }
});

test('total message count is at least 120 (40 per tone)', () => {
  for (const tone of ['calm', 'playful', 'silly']) {
    let total = 0;
    for (const stage of STAGES) {
      total += PROGRESS_MESSAGES[tone][stage].length;
    }
    assert.ok(total >= 40, `${tone} should have at least 40 total messages, got ${total}`);
  }
});

test('WORKING_HARDER_MESSAGES has all three tones with at least 5 messages each', () => {
  for (const tone of ['calm', 'playful', 'silly']) {
    const pool = WORKING_HARDER_MESSAGES[tone];
    assert.ok(Array.isArray(pool), `working harder ${tone} should be an array`);
    assert.ok(pool.length >= 5, `working harder ${tone} should have at least 5 messages, got ${pool.length}`);
  }
});

test('all messages are non-empty strings', () => {
  for (const tone of ['calm', 'playful', 'silly']) {
    for (const stage of STAGES) {
      for (const msg of PROGRESS_MESSAGES[tone][stage]) {
        assert.equal(typeof msg, 'string');
        assert.ok(msg.length > 0, `empty message in ${tone}.${stage}`);
      }
    }
    for (const msg of WORKING_HARDER_MESSAGES[tone]) {
      assert.equal(typeof msg, 'string');
      assert.ok(msg.length > 0, `empty working harder message in ${tone}`);
    }
  }
});

test('phaseToStage maps all nine internal phases correctly', () => {
  assert.equal(phaseToStage('receive_upload'), 'reading');
  assert.equal(phaseToStage('build_manifest'), 'reading');
  assert.equal(phaseToStage('extract_layouts'), 'reading');
  assert.equal(phaseToStage('prepare_web_layouts'), 'reading');
  assert.equal(phaseToStage('download_language_pack'), 'preparing');
  assert.equal(phaseToStage('translate_pages'), 'translating');
  assert.equal(phaseToStage('fit_pages'), 'finishing');
  assert.equal(phaseToStage('render_outputs'), 'finishing');
  assert.equal(phaseToStage('create_working_session'), 'finishing');
});

test('phaseToStage falls back to reading for unknown phases', () => {
  assert.equal(phaseToStage('unknown_phase'), 'reading');
  assert.equal(phaseToStage(''), 'reading');
});

test('getProgressMessage returns a string from the correct pool', () => {
  for (const tone of ['calm', 'playful', 'silly']) {
    for (const stage of STAGES) {
      const msg = getProgressMessage(tone, stage, false);
      assert.equal(typeof msg, 'string');
      assert.ok(msg.length > 0);
      const pool = PROGRESS_MESSAGES[tone][stage];
      assert.ok(pool.includes(msg), `message "${msg}" should be in ${tone}.${stage} pool`);
    }
  }
});

test('getProgressMessage with workingHarder returns messages from either pool', () => {
  const seen = new Set();
  // Run many times to verify both pools are sampled
  for (let i = 0; i < 100; i++) {
    seen.add(getProgressMessage('playful', 'reading', true));
  }
  const normalPool = new Set(PROGRESS_MESSAGES.playful.reading);
  const harderPool = new Set(WORKING_HARDER_MESSAGES.playful);
  let hasNormal = false;
  let hasHarder = false;
  for (const msg of seen) {
    if (normalPool.has(msg)) hasNormal = true;
    if (harderPool.has(msg)) hasHarder = true;
  }
  assert.ok(hasNormal, 'should include messages from normal pool');
  assert.ok(hasHarder, 'should include messages from working-harder pool');
});

test('getProgressMessage avoids immediate repeats', () => {
  let repeats = 0;
  let prev = '';
  for (let i = 0; i < 50; i++) {
    const msg = getProgressMessage('silly', 'translating', false);
    if (msg === prev) repeats++;
    prev = msg;
  }
  // With 10 messages and anti-repeat logic, repeats should be very rare
  assert.ok(repeats < 5, `too many immediate repeats: ${repeats}`);
});

test('getProgressMessage falls back gracefully for invalid tone/stage', () => {
  const msg = getProgressMessage('invalid', 'invalid', false);
  assert.equal(typeof msg, 'string');
  assert.ok(msg.length > 0);
});
