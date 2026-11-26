// Portfolios: returns from prices, expected return and risk of a mix, the
// efficient frontier and the capital asset pricing model. With rational
// data every answer here is exact except a standard deviation or a Sharpe
// ratio, which are square roots and come back as certified enclosures.
//
// The frontier with short sales allowed has a closed form (Merton 1972).
// Without short sales it is a small quadratic program; it is solved exactly
// by trying each set of assets that may be held and keeping the one whose
// optimality (Karush–Kuhn–Tucker) conditions hold, which for a convex
// problem proves the answer is the minimum.
import { Rational, RationalInterval } from "@ratmath/core";
import { mean as meanOf, covariance as covOf, variance as varOf } from "@ratmath/stats";
import { enclose } from "@ratmath/analytic";
import { refuse, amount, ZERO, ONE, Q } from "./money.js";

const point = (q) => new RationalInterval(q, q);
const sqrtQ = (q, bits = 80) => {
  if (q.numerator < 0n) refuse("domain", "a negative variance");
  const r = enclose.sqrt(point(q), bits);
  return r.low.equals(r.high) ? r.low : r;
};
const dot = (a, b) => a.reduce((s, x, i) => s.add(x.multiply(b[i])), ZERO);
const matVec = (M, v) => M.map((row) => dot(row, v));

/** Solve M x = b exactly (Gauss–Jordan over the rationals); null when M is singular. */
export function solveExact(M, b) {
  const n = M.length;
  const A = M.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    const p = A.findIndex((row, r) => r >= c && row[c].numerator !== 0n);
    if (p < 0) return null;
    [A[c], A[p]] = [A[p], A[c]];
    const inv = ONE.divide(A[c][c]);
    for (let j = c; j <= n; j++) A[c][j] = A[c][j].multiply(inv);
    for (let r = 0; r < n; r++) {
      if (r === c || A[r][c].numerator === 0n) continue;
      const f = A[r][c];
      for (let j = c; j <= n; j++) A[r][j] = A[r][j].subtract(f.multiply(A[c][j]));
    }
  }
  return A.map((row) => row[n]);
}

/** Simple returns p[k+1]/p[k] − 1 from a list of prices; exact. */
export function returnsFrom(prices) {
  const p = prices.map(amount);
  if (p.length < 2) refuse("bad-data", "returns need at least two prices");
  if (p.some((x) => x.numerator <= 0n)) refuse("bad-data", "prices are positive");
  return p.slice(1).map((x, k) => x.divide(p[k]).subtract(ONE));
}

const matrixOf = (cov, n) => {
  const S = cov.map((row) => row.map(amount));
  if (S.length !== n || S.some((row) => row.length !== n)) refuse("bad-data", `the covariance matrix is ${n} by ${n}`);
  for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) if (!S[i][j].equals(S[j][i])) refuse("bad-data", "the covariance matrix is symmetric");
  return S;
};

export class Portfolio {
  /**
   * { names, means, covariance } or { names, returns: [[asset 1's returns], …] }
   * (sample means and sample covariances, exact). `riskFree` is optional.
   */
  constructor({ names, means, covariance, returns, riskFree = null }) {
    if (returns) {
      const R = returns.map((r) => r.map(amount));
      if (R.length < 1 || R.some((r) => r.length !== R[0].length || r.length < 2)) refuse("bad-data", "each asset has the same number of returns, at least two");
      means = R.map((r) => meanOf(r));
      covariance = R.map((a) => R.map((b) => covOf(a, b)));
      this.returns = R;
    }
    if (!means || !covariance) refuse("bad-data", "a portfolio needs means and a covariance matrix, or returns");
    this.means = means.map(amount);
    this.n = this.means.length;
    this.covariance = matrixOf(covariance, this.n);
    this.names = names ?? this.means.map((_, i) => `asset ${i + 1}`);
    this.riskFree = riskFree === null ? null : amount(riskFree);
    this._inv = null;
  }
  _weights(w) {
    const x = w.map(amount);
    if (x.length !== this.n) refuse("bad-weights", `give ${this.n} weights`);
    return x;
  }
  /** Expected return wᵀμ, exact. */
  expectedReturn(w) {
    return dot(this._weights(w), this.means);
  }
  /** Variance wᵀΣw, exact. */
  variance(w) {
    const x = this._weights(w);
    return dot(x, matVec(this.covariance, x));
  }
  /** Standard deviation, certified. */
  risk(w, { bits = 80 } = {}) {
    return sqrtQ(this.variance(w), bits);
  }
  /** Σ⁻¹1 and Σ⁻¹μ, and the frontier constants A = 1ᵀΣ⁻¹1, B = 1ᵀΣ⁻¹μ, C = μᵀΣ⁻¹μ, D = AC − B². */
  constants() {
    if (this._inv) return this._inv;
    const ones = this.means.map(() => ONE);
    const a = solveExact(this.covariance, ones);
    const b = solveExact(this.covariance, this.means);
    if (!a || !b) refuse("singular", "the covariance matrix is singular: some mix of the assets has no risk");
    const A = dot(ones, a);
    const B = dot(ones, b);
    const C = dot(this.means, b);
    const D = A.multiply(C).subtract(B.multiply(B));
    this._inv = { invOnes: a, invMeans: b, A, B, C, D };
    return this._inv;
  }
  /** The portfolio of least variance: w = Σ⁻¹1 / A. */
  minimumVariance() {
    const { invOnes, A, B } = this.constants();
    const w = invOnes.map((x) => x.divide(A));
    return this._report(w, { expectedReturn: B.divide(A), variance: ONE.divide(A) });
  }
  /**
   * The least-variance portfolio with expected return `target`, short sales
   * allowed: w = Σ⁻¹(λ1 + γμ) with λ = (C − B·m)/D, γ = (A·m − B)/D, and
   * variance (A·m² − 2B·m + C)/D. Exact.
   */
  frontier(target) {
    const m = amount(target);
    const { invOnes, invMeans, A, B, C, D } = this.constants();
    if (D.numerator === 0n) refuse("degenerate", "every asset has the same expected return: the frontier is a single point");
    const lam = C.subtract(B.multiply(m)).divide(D);
    const gam = A.multiply(m).subtract(B).divide(D);
    const w = invOnes.map((x, i) => lam.multiply(x).add(gam.multiply(invMeans[i])));
    const v = A.multiply(m).multiply(m).subtract(Q(2).multiply(B).multiply(m)).add(C).divide(D);
    return this._report(w, { expectedReturn: m, variance: v });
  }
  /**
   * The same with no short sales (every weight ≥ 0), for up to 12 assets.
   * Each support set S is tried: the equality-constrained problem on S is
   * solved exactly, and the answer is kept when its weights are ≥ 0 and the
   * multipliers say no asset left out would lower the variance. Those are the
   * KKT conditions of a convex problem, so the answer is the minimum.
   */
  frontierLongOnly(target) {
    const m = amount(target);
    const n = this.n;
    if (n > 12) refuse("too-large", "the long-only frontier tries every set of assets; 12 assets at most");
    const lo = this.means.reduce((a, b) => (b.compareTo(a) < 0 ? b : a));
    const hi = this.means.reduce((a, b) => (b.compareTo(a) > 0 ? b : a));
    if (m.compareTo(lo) < 0 || m.compareTo(hi) > 0) refuse("infeasible", `with no short sales the expected return lies between ${lo} and ${hi}`);
    const S2 = this.covariance.map((row) => row.map((x) => x.multiply(Q(2))));
    let best = null;
    for (let mask = 1; mask < 1 << n; mask++) {
      const idx = [];
      for (let i = 0; i < n; i++) if (mask & (1 << i)) idx.push(i);
      // [2Σ_SS  −1  −μ_S] [w]   [0]
      // [1ᵀ      0   0  ] [λ] = [1]
      // [μ_Sᵀ    0   0  ] [γ]   [m]
      const k = idx.length;
      const M = [];
      for (const i of idx) M.push([...idx.map((j) => S2[i][j]), ONE.negate(), this.means[i].negate()]);
      M.push([...idx.map(() => ONE), ZERO, ZERO]);
      M.push([...idx.map((j) => this.means[j]), ZERO, ZERO]);
      const rhs = [...idx.map(() => ZERO), ONE, m];
      let sol = solveExact(M, rhs);
      let gammaFree = false;
      if (!sol) {
        // the return constraint may be implied (all means in S equal); drop γ
        const M2 = M.slice(0, k + 1).map((row) => row.slice(0, k + 1));
        if (!idx.every((j) => this.means[j].equals(m))) continue;
        const s2 = solveExact(M2, rhs.slice(0, k + 1));
        if (!s2) continue;
        sol = [...s2, ZERO];
        gammaFree = true;
      }
      const wS = sol.slice(0, k);
      if (wS.some((x) => x.numerator < 0n)) continue;
      const [lam, gam] = [sol[k], sol[k + 1]];
      const w = new Array(n).fill(ZERO);
      idx.forEach((j, t) => (w[j] = wS[t]));
      // stationarity for the assets left out: 2(Σw)_j − λ − γμ_j ≥ 0
      const g = matVec(S2, w);
      const ok = gammaFree ? null : idx.length === n || g.every((x, j) => mask & (1 << j) || x.subtract(lam).subtract(gam.multiply(this.means[j])).numerator >= 0n);
      if (ok === false) continue;
      const v = this.variance(w);
      if (ok === true) return this._report(w, { expectedReturn: m, variance: v, support: idx.filter((j) => w[j].numerator !== 0n).map((j) => this.names[j]), certificate: { lambda: lam, gamma: gam } });
      if (!best || v.compareTo(best.v) < 0) best = { w, v, idx };
    }
    if (best) return this._report(best.w, { expectedReturn: m, variance: best.v, support: best.idx.filter((j) => best.w[j].numerator !== 0n).map((j) => this.names[j]), certificate: null });
    refuse("infeasible", "no long-only portfolio has that expected return");
  }
  /** The tangency portfolio for a risk-free rate: w ∝ Σ⁻¹(μ − r·1), and its Sharpe ratio (certified). */
  tangency(riskFree = this.riskFree) {
    if (riskFree === null) refuse("bad-argument", "the tangency portfolio needs a risk-free rate");
    const r = amount(riskFree);
    const excess = this.means.map((x) => x.subtract(r));
    const z = solveExact(this.covariance, excess);
    if (!z) refuse("singular", "the covariance matrix is singular");
    const s = z.reduce((a, b) => a.add(b), ZERO);
    if (s.numerator === 0n) refuse("degenerate", "no tangency portfolio: the risk-free rate equals the minimum-variance portfolio's return");
    const w = z.map((x) => x.divide(s));
    const sharpe2 = dot(excess, z);
    return this._report(w, { sharpeSquared: sharpe2, sharpe: sqrtQ(sharpe2), riskFree: r });
  }
  _report(w, extra) {
    const out = { weights: Object.fromEntries(this.names.map((nm, i) => [nm, w[i]])), w, expectedReturn: this.expectedReturn(w), variance: this.variance(w), ...extra };
    out.risk = sqrtQ(out.variance);
    return out;
  }
}
export const portfolio = (spec) => new Portfolio(spec);

/**
 * The capital asset pricing model from returns: β = cov(asset, market) /
 * var(market), α = mean(asset) − (r + β·(mean(market) − r)), and the
 * required return r + β·(E[market] − r). Exact.
 */
export function capm({ asset, market, riskFree = 0, marketReturn = null }) {
  const a = asset.map(amount);
  const mk = market.map(amount);
  if (a.length !== mk.length || a.length < 2) refuse("bad-data", "asset and market returns are paired, at least two of each");
  const r = amount(riskFree);
  const vm = varOf(mk);
  if (vm.numerator === 0n) refuse("bad-data", "the market's returns do not vary");
  const beta = covOf(a, mk).divide(vm);
  const em = marketReturn === null ? meanOf(mk) : amount(marketReturn);
  const required = r.add(beta.multiply(em.subtract(r)));
  const alpha = meanOf(a).subtract(r.add(beta.multiply(meanOf(mk).subtract(r))));
  return { beta, alpha, required, marketPremium: em.subtract(r), riskFree: r };
}
