export function scorePair(features, weights) {
  let sum = weights.bias;
  for (let i = 0; i < features.length; i++) {
    sum += features[i] * weights.w[i];
  }
  return sum;
}

function sigmoid(x) {
  if (x >= 0) return 1 / (1 + Math.exp(-x));
  const ex = Math.exp(x);
  return ex / (1 + ex);
}

export function trainLogisticRegression(data, opts) {
  const { featureCount, learningRate = 0.1, epochs = 200, lambda = 0.01 } = opts;
  const w = new Float64Array(featureCount);
  let bias = 0;
  const n = data.length;

  for (let epoch = 0; epoch < epochs; epoch++) {
    const gradW = new Float64Array(featureCount);
    let gradB = 0;

    for (const { features, label } of data) {
      const z = features.reduce((s, f, i) => s + f * w[i], bias);
      const pred = sigmoid(z);
      const error = pred - label;
      for (let i = 0; i < featureCount; i++) {
        gradW[i] += error * features[i];
      }
      gradB += error;
    }

    for (let i = 0; i < featureCount; i++) {
      w[i] -= learningRate * (gradW[i] / n + lambda * w[i]);
    }
    bias -= learningRate * (gradB / n);
  }

  let correct = 0;
  for (const { features, label } of data) {
    const z = features.reduce((s, f, i) => s + f * w[i], bias);
    if ((z > 0 ? 1 : 0) === label) correct++;
  }

  return {
    weights: { w: Array.from(w), bias },
    metrics: { accuracy: correct / n },
  };
}
