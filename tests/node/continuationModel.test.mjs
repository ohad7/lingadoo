import assert from 'node:assert/strict';
import test from 'node:test';
import { scorePair, trainLogisticRegression } from '../../src/lib/continuationModel.js';

test('scorePair returns positive for features aligned with positive weights', () => {
  const weights = { w: [1, -1, 0.5], bias: 0 };
  assert.ok(scorePair([1, 0, 1], weights) > 0);
});

test('scorePair returns negative for features aligned with negative weights', () => {
  const weights = { w: [1, -1, 0.5], bias: 0 };
  assert.ok(scorePair([0, 1, 0], weights) < 0);
});

test('bias shifts the decision boundary', () => {
  const weights = { w: [0.5], bias: -1 };
  assert.ok(scorePair([1], weights) < 0);
  assert.ok(scorePair([3], weights) > 0);
});

test('trainLogisticRegression learns to separate positive and negative examples', () => {
  const data = [];
  for (let i = 0; i < 100; i++) {
    data.push({ features: [1, 0], label: 1 });
    data.push({ features: [0, 1], label: 0 });
  }
  const result = trainLogisticRegression(data, {
    featureCount: 2,
    learningRate: 0.5,
    epochs: 100,
    lambda: 0.01,
  });
  assert.ok(scorePair([1, 0], result.weights) > 0);
  assert.ok(scorePair([0, 1], result.weights) < 0);
  assert.ok(result.metrics.accuracy > 0.9);
});
