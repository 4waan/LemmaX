// Numerical Beta quantiles for the bounded assessment domain.
// Uses the regularized incomplete Beta continued fraction and bisection.
const COEFFICIENTS = [
  676.5203681218851, -1259.1392167224028, 771.3234287776531,
  -176.6150291621406, 12.507343278686905, -0.13857109526572012,
  9.984369578019572e-6, 1.5056327351493116e-7,
];

function logGamma(value) {
  const z = value - 1;
  let sum = 0.99999999999980993;
  for (let i = 0; i < COEFFICIENTS.length; i++) sum += COEFFICIENTS[i] / (z + i + 1);
  const t = z + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(sum);
}

function guard(value) {
  return Math.abs(value) < 1e-300 ? (value < 0 ? -1e-300 : 1e-300) : value;
}

function fraction(a, b, x) {
  let c = 1;
  let d = 1 / guard(1 - (a + b) * x / (a + 1));
  let h = d;
  for (let m = 1; m <= 10000; m++) {
    const twice = 2 * m;
    let aa = m * (b - m) * x / ((a + twice - 1) * (a + twice));
    d = 1 / guard(1 + aa * d);
    c = guard(1 + aa / c);
    h *= d * c;
    aa = -(a + m) * (a + b + m) * x / ((a + twice) * (a + twice + 1));
    d = 1 / guard(1 + aa * d);
    c = guard(1 + aa / c);
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 3e-14) return h;
  }
  throw new RangeError("Beta continued fraction did not converge");
}

export function validateBetaParameters(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0.5 || b < 0.5 || a + b > 10000) {
    throw new RangeError("Beta parameters must each be >= 0.5 with sum <= 10000");
  }
}

export function betaCdf(x, a, b) {
  validateBetaParameters(a, b);
  if (!Number.isFinite(x) || x < 0 || x > 1) throw new RangeError("x must be in [0, 1]");
  if (x === 0 || x === 1) return x;
  const weight = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b)
    + a * Math.log(x) + b * Math.log1p(-x));
  const result = x < (a + 1) / (a + b + 2)
    ? weight * fraction(a, b, x) / a
    : 1 - weight * fraction(b, a, 1 - x) / b;
  if (!Number.isFinite(result)) throw new RangeError("Nonfinite Beta CDF");
  return Math.max(0, Math.min(1, result));
}

export function betaQuantile(probability, a, b) {
  validateBetaParameters(a, b);
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new RangeError("Probability must be in [0, 1]");
  }
  if (probability === 0 || probability === 1) return probability;
  let low = 0;
  let high = 1;
  for (let i = 0; i < 100; i++) {
    const middle = (low + high) / 2;
    if (middle === low || middle === high) break;
    if (betaCdf(middle, a, b) < probability) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}
