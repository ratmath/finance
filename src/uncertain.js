// Uncertain inputs and repeated runs. A *process* turns a seeded random
// stream into a path: one growth factor per period (1 + the return or the
// interest for that period). `simulate` draws a path for each uncertain
// input, projects the scenario exactly along those paths, and does that many
// times from one seed. Everything it reports is a simulated answer: it
// carries its seed and the size of its own sampling error.
//
// Draws from continuous distributions are floating-point numbers; they are
// rounded to a stated grid (8 decimal places of the per-period rate by
// default) and from then on all arithmetic is exact, so two runs from the
// same seed agree to the cent on every machine.
import { Rational } from "@ratmath/core";
import { rng as makeRng } from "@ratmath/discrete";
import { SimulatedRate, proportionInterval, variance, sqrt, normal } from "@ratmath/stats";
import { refuse, amount, ZERO, ONE, Q, round, show } from "./money.js";
import { Scenario } from "./scenario.js";

const GRID = 8;
const fromFloat = (x, places = GRID) => {
  if (!Number.isFinite(x)) refuse("bad-draw", `a draw came out as ${x}`);
  const scale = 10 ** places;
  return new Rational(BigInt(Math.round(x * scale)), 10n ** BigInt(places));
};
/** a draw from anything with sample(rng): a stats distribution, or your own */
const drawOf = (dist, rng, what) => {
  if (!dist || typeof dist.sample !== "function") refuse("bad-process", `${what} needs a distribution with sample(rng), such as normal("7%", "15%") from @ratmath/stats`);
  const x = dist.sample(rng);
  if (x instanceof Rational) return x;
  if (typeof x === "bigint") return new Rational(x);
  return fromFloat(Number(x));
};
const whole = (n, what, min = 0) => (Number.isInteger(n) && n >= min ? n : refuse("bad-argument", `${what} is a whole number${min ? ` from ${min}` : ""}`));

/**
 * The per-period growth factor that compounds to 1 + R over a year of m
 * periods: exact when the root is rational (always when m = 1), otherwise
 * rounded to the grid.
 */
function perPeriod(R, m) {
  const g = ONE.add(R);
  if (g.numerator <= 0n) refuse("bad-draw", `a return of ${show(R, 4)} would leave less than nothing`);
  if (m === 1) return g;
  return ONE.add(fromFloat(g.toNumber() ** (1 / m) - 1));
}

export class Process {
  /** `make(rng, periods, m)` returns an array of `periods` growth factors (Rationals). */
  constructor(name, make, info = {}) {
    this.name = name;
    this.make = make;
    Object.assign(this, info);
  }
  /** One path: growth factors for each period, from a generator or a seed. */
  path(rng, periods, periodsPerYear = 12) {
    const r = typeof rng === "object" && rng ? rng : makeRng(rng ?? 1);
    const out = this.make(r, whole(periods, "periods", 1), whole(periodsPerYear, "periodsPerYear", 1));
    if (out.length !== periods) throw new Error(`process ${this.name} gave ${out.length} factors for ${periods} periods`);
    return out;
  }
  /** The same path as annual nominal rates per period, which is what a scenario account takes. */
  rates(rng, periods, periodsPerYear = 12) {
    const m = Q(periodsPerYear);
    return this.path(rng, periods, periodsPerYear).map((g) => g.subtract(ONE).multiply(m));
  }
  toString() {
    return this.name;
  }
}

/** annual return R for each year, spread evenly over its periods */
const yearly = (name, drawYear, info) =>
  new Process(name, (rng, periods, m) => {
    const out = [];
    for (let year = 0; out.length < periods; year++) {
      const f = perPeriod(drawYear(rng, year), m);
      for (let j = 0; j < m && out.length < periods; j++) out.push(f);
    }
    return out;
  }, info);

export const processes = Object.freeze({
  /** the same annual rate every year: no uncertainty, useful as a baseline */
  fixed(rate) {
    const R = amount(rate);
    return yearly(`fixed(${R})`, () => R, { kind: "fixed", rate: R });
  },
  /** independent annual returns drawn from a distribution */
  independent(dist) {
    return yearly(`independent(${dist})`, (rng) => drawOf(dist, rng, "independent"), { kind: "independent", dist });
  },
  /** annual returns from a finite list with exact weights (default equal): small cases can be enumerated exactly */
  choice(values, weights) {
    const v = values.map(amount);
    const w = (weights ?? v.map(() => 1)).map(amount);
    if (w.length !== v.length || !v.length) refuse("bad-process", "choice needs as many weights as values");
    const total = w.reduce((a, b) => a.add(b), ZERO);
    // exact weighted draw: a uniform integer below the common denominator
    const den = w.reduce((d, x) => lcm(d, x.denominator), total.denominator);
    const ticks = w.map((x) => x.multiply(new Rational(den)).numerator);
    const all = total.multiply(new Rational(den)).numerator;
    return yearly(`choice(${v.join(", ")})`, (rng) => {
      let u = rng.int(all);
      for (let i = 0; i < v.length; i++) {
        if (u < ticks[i]) return v[i];
        u -= ticks[i];
      }
      return v[v.length - 1];
    }, { kind: "choice", values: v, weights: w });
  },
  /** the annual returns given, in order (the last one repeats if the run is longer) */
  sequence(returns) {
    const r = returns.map(amount);
    if (!r.length) refuse("bad-process", "sequence needs at least one return");
    return yearly(`sequence(${r.length} years)`, (rng, year) => r[Math.min(year, r.length - 1)], { kind: "sequence", returns: r });
  },
  /** annual returns resampled from history the caller supplies, in blocks of `block` consecutive years */
  resample(history, { block = 1 } = {}) {
    const h = history.map(amount);
    whole(block, "block", 1);
    if (h.length < block) refuse("bad-process", "the history is shorter than one block");
    return new Process(`resample(${h.length} years, block ${block})`, (rng, periods, m) => {
      const years = [];
      while (years.length * m < periods) {
        const s = rng.int(h.length - block + 1);
        for (let j = 0; j < block; j++) years.push(h[s + j]);
      }
      const out = [];
      for (const R of years) {
        const f = perPeriod(R, m);
        for (let j = 0; j < m && out.length < periods; j++) out.push(f);
      }
      return out;
    }, { kind: "resample", history: h, block });
  },
  /**
   * Geometric Brownian motion with annual drift μ and volatility σ: each
   * period's factor is exp((μ − σ²/2)Δt + σ√Δt·Z), Δt = 1/periodsPerYear,
   * so E[factor over a year] = e^μ.
   */
  gbm({ drift, volatility }) {
    const mu = amount(drift).toNumber();
    const sigma = amount(volatility).toNumber();
    if (sigma < 0) refuse("bad-process", "volatility is not negative");
    const Z = normal(0, 1);
    return new Process(`gbm(${drift}, ${volatility})`, (rng, periods, m) => {
      const dt = 1 / m;
      const out = [];
      for (let k = 0; k < periods; k++) out.push(ONE.add(fromFloat(Math.expm1((mu - sigma * sigma / 2) * dt + sigma * Math.sqrt(dt) * Z.sample(rng)))));
      return out;
    }, { kind: "gbm", drift: amount(drift), volatility: amount(volatility) });
  },
  /**
   * An interest rate that wanders: each year it moves by a draw from `step`,
   * kept between `min` and `max`. The path is the rate credited (as rate/m
   * each period), not a return.
   */
  walk({ start, step, min = "-1", max = "1" }) {
    const [r0, lo, hi] = [amount(start), amount(min), amount(max)];
    return new Process(`walk(${r0})`, (rng, periods, m) => {
      const out = [];
      let r = r0;
      for (let k = 0; k < periods; k++) {
        if (k > 0 && k % m === 0) {
          r = r.add(drawOf(step, rng, "walk"));
          if (r.compareTo(lo) < 0) r = lo;
          if (r.compareTo(hi) > 0) r = hi;
        }
        out.push(ONE.add(r.divide(Q(m))));
      }
      return out;
    }, { kind: "walk", start: r0, step, min: lo, max: hi });
  },
  /**
   * A mean-reverting (Vasicek) rate: each period
   * r ← r + speed·(mean − r)·Δt + volatility·√Δt·Z, kept at or above `floor`.
   */
  meanReverting({ start, mean, speed, volatility, floor = null }) {
    const [r0, th, a, s] = [start, mean, speed, volatility].map((x) => amount(x).toNumber());
    const fl = floor === null ? -Infinity : amount(floor).toNumber();
    const Z = normal(0, 1);
    return new Process(`meanReverting(${start} → ${mean})`, (rng, periods, m) => {
      const dt = 1 / m;
      const out = [];
      let r = r0;
      for (let k = 0; k < periods; k++) {
        out.push(ONE.add(fromFloat(r * dt)));
        r = Math.max(fl, r + a * (th - r) * dt + s * Math.sqrt(dt) * Z.sample(rng));
      }
      return out;
    }, { kind: "meanReverting", start: amount(start), mean: amount(mean), speed: amount(speed), volatility: amount(volatility) });
  },
});
function lcm(a, b) {
  const g = (x, y) => (y === 0n ? x : g(y, x % y));
  return (a / g(a, b)) * b;
}

/** occurrence multipliers for a one-off event: 0 most periods, the amount factor when it happens */
function eventIndex(e, rng, periods, m) {
  const p = amount(e.probability);
  if (p.numerator < 0n || p.compareTo(ONE) > 0) refuse("bad-event", `event "${e.name}": a probability is between 0 and 1`);
  const per = e.per ?? "year";
  if (per !== "year" && per !== "period") refuse("bad-event", 'per is "year" or "period"');
  const hit = () => rng.bool(p);
  const size = () => (e.amount !== undefined && typeof e.amount?.sample === "function" ? round(drawOf(e.amount, rng, "an event amount"), { places: 2 }) : ONE);
  const out = new Array(periods).fill(ZERO);
  const start = (e.start ?? 1) - 1;
  const end = Math.min(periods, e.end ?? periods);
  let happened = false;
  if (per === "period") {
    for (let k = start; k < end && !(e.once && happened); k++) if (hit()) (out[k] = size(), (happened = true));
  } else {
    for (let y = Math.floor(start / m); y * m < end && !(e.once && happened); y++) {
      if (!hit()) continue;
      const k = Math.max(start, y * m) + rng.int(Math.min(m, end - Math.max(start, y * m)));
      out[k] = size();
      happened = true;
    }
  }
  return out;
}

/** The input to Scenario with this run's paths written in. */
function concrete(spec, paths, inflationIndex, indexed, events, rng, rounding) {
  const m = spec.periodsPerYear ?? 12;
  const periods = spec.periods;
  const accounts = (spec.accounts ?? []).map((a) => (paths[a.name] ? { ...a, rates: paths[a.name] } : a));
  const flows = (spec.flows ?? []).map((f) => (inflationIndex && indexed.has(f.name ?? "") ? { ...f, index: inflationIndex } : f));
  for (const e of events) {
    const idx = eventIndex(e, rng.fork(`event ${e.name}`), periods, m);
    const amt = e.amount !== undefined && typeof e.amount?.sample === "function" ? ONE : amount(e.amount);
    flows.push({ name: e.name, amount: amt, from: e.from, to: e.to, index: inflationIndex && e.indexed ? idx.map((x, k) => x.multiply(inflationIndex[k])) : idx });
  }
  return new Scenario({ ...spec, accounts, flows, rounding });
}

const KEEP = (p) => p.netWorth;

export class Simulation {
  constructor(fields) {
    Object.assign(this, fields);
    this.kind = "simulated";
    Object.freeze(this);
  }
  /** The p-quantile of the outcomes (0 ≤ p ≤ 1), by the nearest-rank rule: always one of the outcomes. */
  quantile(p) {
    return nearestRank(this.sorted, amount(p));
  }
  toString() {
    const pct = this.percentiles;
    return `${this.name ?? "simulation"}: ${this.runs} runs, seed ${JSON.stringify(this.seed)}; median ${show(pct[50] ?? this.quantile("1/2"), 2)}, mean ${show(this.mean, 2)} ± ${show(this.standardError, 2)}; ruin ${show(this.ruin.rate, 4)} [${show(this.ruin.interval.low, 4)}, ${show(this.ruin.interval.high, 4)}]`;
  }
  [Symbol.for("nodejs.util.inspect.custom")]() {
    return this.toString();
  }
}
function nearestRank(sorted, p) {
  const n = sorted.length;
  if (p.numerator < 0n || p.compareTo(ONE) > 0) refuse("bad-argument", "a quantile is between 0 and 1");
  const r = p.multiply(Q(n));
  let k = Number(r.numerator / r.denominator) + (r.denominator === 1n ? 0 : 1);
  return sorted[Math.min(n, Math.max(1, k)) - 1];
}
const cmpQ = (a, b) => a.compareTo(b);

/**
 * Many runs of a scenario with uncertain inputs.
 *
 *   simulate(spec, {
 *     returns: { stocks: processes.gbm({ drift: "6%", volatility: "18%" }) },
 *     inflation: processes.independent(normal("2.5%", "1%")),
 *     indexed: ["spending"],          // flows that grow with inflation
 *     events: [{ name: "repair", probability: "10%", amount: 5000, from: "cash" }],
 *     runs: 1000, seed: 1 })
 *
 * `returns` maps account names to processes whose path replaces the
 * account's rate. `events` are one-off random flows: `probability` per year
 * (or per period with per: "period"), `once` to stop after the first, an
 * `amount` that is fixed or a distribution. Run i uses the stream
 * rng(seed).fork("run i"), so a run does not depend on how many there are.
 *
 * The result: `outcomes` (one per run, in run order), `mean` (exact),
 * `standardError`, `percentiles` and `quantile(p)`, `ruin` (how often an
 * account that started at or above zero went below it, as a SimulatedRate
 * with an exact Clopper–Pearson interval), `ruinTimes`, `bands` (percentiles
 * of the tracked quantity at each period), and `real` outcomes in today's
 * money when there is inflation. Balances are rounded to the cent each
 * period unless the scenario names another rule or `rounding: false`.
 */
export function simulate(spec, { returns = {}, inflation = null, indexed = [], events = [], runs = 1000, seed = 1, rounding, measure = KEEP, ruin = null, level = "0.95", percentiles = [5, 25, 50, 75, 95], track = "netWorth", name } = {}) {
  if (spec instanceof Scenario) refuse("bad-argument", "simulate takes the scenario's description (the object you would pass to scenario), so it can write the paths in");
  const R = whole(runs, "runs", 1);
  const m = spec.periodsPerYear ?? 12;
  const periods = whole(spec.periods, "periods", 1);
  for (const [acct, proc] of Object.entries(returns)) {
    if (!(proc instanceof Process)) refuse("bad-process", `returns.${acct} is not a process (use processes.gbm, processes.independent, …)`);
    if (!(spec.accounts ?? []).some((a) => a.name === acct)) refuse("bad-process", `returns names an account "${acct}" that the scenario does not have`);
  }
  if (inflation !== null && !(inflation instanceof Process)) refuse("bad-process", "inflation is a process");
  const ix = new Set(indexed);
  for (const f of ix) if (!(spec.flows ?? []).some((g) => g.name === f)) refuse("bad-process", `indexed names a flow "${f}" that the scenario does not have`);
  const rule = rounding !== undefined ? rounding : spec.rounding !== undefined && spec.rounding !== false ? spec.rounding : 2;
  const base = makeRng(seed);
  const outcomes = [];
  const real = [];
  const series = Array.from({ length: periods + 1 }, () => []);
  let ruined = 0;
  const ruinTimes = [];
  for (let i = 0; i < R; i++) {
    const rng = base.fork(`run ${i}`);
    const paths = {};
    for (const [acct, proc] of Object.entries(returns)) paths[acct] = proc.rates(rng.fork(`returns ${acct}`), periods, m);
    let index = null;
    if (inflation) {
      const g = inflation.path(rng.fork("inflation"), periods, m);
      index = [];
      let acc = ONE;
      for (const f of g) index.push((acc = rule === false ? acc.multiply(f) : round(acc.multiply(f), { places: GRID })));
    }
    // the price level is kept to the grid (exact when rounding is off); a flow is indexed by the level at the start of its period
    const flowIndex = index ? [ONE, ...index.slice(0, -1)] : null;
    const proj = concrete(spec, paths, flowIndex, ix, events, rng, rule).project();
    const out = measure(proj);
    outcomes.push(out);
    if (index) real.push(out.divide(index[index.length - 1]));
    const bad = ruin ? ruin(proj) : proj.firstNegative !== null;
    if (bad) {
      ruined++;
      if (proj.firstNegative) ruinTimes.push(proj.firstNegative.period);
    }
    const pick = (row) => (track === "netWorth" ? row.netWorth : row.balances[track]);
    series[0].push(pick(proj.opening));
    proj.rows.forEach((row, k) => series[k + 1].push(pick(row)));
  }
  const sorted = [...outcomes].sort(cmpQ);
  const mean = outcomes.reduce((a, b) => a.add(b), ZERO).divide(Q(R));
  const se = R > 1 ? sqrt(variance(outcomes).divide(Q(R)), 40) : null;
  const ps = percentiles.map((p) => amount(p));
  const pctOf = (xs) => Object.fromEntries(ps.map((p) => [p.toString(), nearestRank(xs, p.divide(Q(100)))]));
  const bands = series.map((xs, k) => ({ period: k, ...pctOf([...xs].sort(cmpQ)) }));
  const ci = proportionInterval(ruined, R, { level });
  return new Simulation({
    name,
    seed,
    runs: R,
    rounding: rule,
    outcomes,
    sorted,
    mean,
    standardError: se,
    percentiles: pctOf(sorted),
    ruin: new SimulatedRate({ rate: Q(ruined, R), hits: ruined, runs: R, seed, interval: { low: ci.low, high: ci.high, level: ci.level } }),
    ruinTimes,
    bands,
    real: index_or_null(real, R),
  });
}
const index_or_null = (real, R) => (real.length === R ? Object.freeze({ outcomes: real, mean: real.reduce((a, b) => a.add(b), ZERO).divide(Q(R)), median: nearestRank([...real].sort(cmpQ), Q(1, 2)) }) : null);

/**
 * The order of good and bad years. The same annual returns are applied to
 * an account in several orders (as given, reversed, best first, worst first,
 * and `shuffles` random orders from `seed`) and each projection is exact.
 * With no money going in or out the order cannot matter (multiplication
 * commutes), and `orderMatters` is false; withdrawals or contributions make
 * it matter, and `spread` says by how much.
 */
export function sequenceRisk(spec, { account, returns, shuffles = 0, seed = 1, measure = KEEP } = {}) {
  const r = returns.map(amount);
  const m = spec.periodsPerYear ?? 12;
  if (!(spec.accounts ?? []).some((a) => a.name === account)) refuse("bad-argument", `the scenario has no account "${account}"`);
  if (spec.periods > r.length * m) refuse("bad-argument", `${r.length} annual returns cover ${r.length * m} periods; the scenario has ${spec.periods}`);
  const orders = [
    ["as given", r],
    ["reversed", [...r].reverse()],
    ["best first", [...r].sort((a, b) => b.compareTo(a))],
    ["worst first", [...r].sort((a, b) => a.compareTo(b))],
  ];
  const g = makeRng(seed);
  for (let i = 0; i < shuffles; i++) orders.push([`shuffle ${i + 1}`, g.fork(`shuffle ${i}`).shuffle(r)]);
  const rows = orders.map(([label, seq]) => {
    const rates = processes.sequence(seq).rates(null, spec.periods, m);
    const proj = new Scenario({ ...spec, accounts: spec.accounts.map((a) => (a.name === account ? { ...a, rates } : a)) }).project();
    return { order: label, returns: seq, outcome: measure(proj), firstNegative: proj.firstNegative };
  });
  const outs = rows.map((x) => x.outcome);
  const hi = outs.reduce((a, b) => (b.compareTo(a) > 0 ? b : a));
  const lo = outs.reduce((a, b) => (b.compareTo(a) < 0 ? b : a));
  return { rows, best: rows.find((x) => x.outcome.equals(hi)).order, worst: rows.find((x) => x.outcome.equals(lo)).order, spread: hi.subtract(lo), orderMatters: !hi.equals(lo) };
}
