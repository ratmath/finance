// Type declarations for @ratmath/finance.
import type { Rational, RationalInterval } from "@ratmath/core";

export interface PlannedPhase {
  phase: number;
  contents: string;
  /** Rough size in source lines, as text. */
  estimate: string;
}
/** The phases still to come. */
export const plan: readonly PlannedPhase[];

export class FinanceError extends Error {
  code: string;
}

/** An exact amount or rate: a whole number, a bigint, a Rational, or a string such as "1234.56", "$1,234.56", "7/8" or "4.5%". A JavaScript number that is not whole is refused. */
export type Amount = Rational | bigint | number | string;
/** Exact when it can be, otherwise an interval proven to contain the value. */
export type Certified = Rational | RationalInterval;
export type RoundingMode = "half-even" | "half-up" | "half-down" | "up" | "down" | "floor" | "ceil";
export interface RoundingRule {
  places?: number;
  mode?: RoundingMode;
}
/** A rule, a number of places, a mode, or false / "none" for no rounding. */
export type Rounding = RoundingRule | number | RoundingMode | boolean | "none" | null;
export interface Digits {
  /** How many digits an interval result should be good to (default 12). */
  digits?: number;
}

// ---- money, rounding, dates ----------------------------------------------------

export function amount(x: Amount): Rational;
export function rate(x: Amount): Rational;
export function round(x: Amount, rule?: RoundingRule): Rational;
export function format(x: Amount, options?: RoundingRule & { currency?: string; separator?: string; percent?: boolean }): string;
/** A decimal with `places` places; an interval prints as one number when both ends round to it. */
export function show(x: Certified, places?: number): string;
/** Shares in proportion to the weights that add up to the total exactly. */
export function allocate(total: Amount, weights: Amount[], options?: { places?: number }): Rational[];
export function power(base: Amount, exponent: Amount, digits?: number): Certified;
export function exp(x: Amount | RationalInterval, digits?: number): RationalInterval;
export function ln(x: Amount | RationalInterval, digits?: number): RationalInterval;

export class CalendarDate {
  constructor(year: number, month: number, day: number);
  year: number;
  month: number;
  day: number;
  /** Days from 1970-01-01. */
  readonly serial: number;
  readonly isEndOfMonth: boolean;
  addDays(n: number): CalendarDate;
  addMonths(n: number, options?: { endOfMonth?: boolean }): CalendarDate;
  compareTo(o: DateLike): number;
  equals(o: DateLike): boolean;
  toString(): string;
}
/** "2027-03-15", "2027-03" (the first of the month), [y, m, d] or a CalendarDate. */
export type DateLike = CalendarDate | string | [number, number, number];
export function date(x: DateLike): CalendarDate;
export function daysBetween(a: DateLike, b: DateLike): number;
export function isLeap(year: number): boolean;
export type DayCount = "30/360" | "30E/360" | "actual/360" | "actual/365" | "actual/actual";
export const DAY_COUNTS: readonly DayCount[];
export function dayCount(from: DateLike, to: DateLike, convention?: DayCount): { days: number; yearFraction: Rational };

// ---- time value ----------------------------------------------------------------

export function simpleInterest(principal: Amount, rate: Amount, time: Amount): { interest: Rational; total: Rational };
export function compound(principal: Amount, rate: Amount, years: Amount, options?: Digits & { periodsPerYear?: Amount | "continuous" }): Certified;
export function effectiveRate(nominal: Amount, periodsPerYear?: Amount | "continuous", options?: Digits): Certified;
export function nominalRate(effective: Amount, periodsPerYear?: Amount | "continuous", options?: Digits): Certified;
export function equivalentRate(nominal: Amount, from: Amount, to: Amount, options?: Digits): Certified;
export function realRate(nominal: Amount, inflation: Amount): Rational;
export function discountFactor(rate: Amount, periods: Amount, options?: Digits): Certified;
export function futureValue(pv: Amount, rate: Amount, periods: Amount, options?: Digits): Certified;
export function presentValue(fv: Amount, rate: Amount, periods: Amount, options?: Digits): Certified;
export interface AnnuitySpec {
  payment?: Amount;
  rate: Amount;
  periods: Amount;
  /** Payments at the start of each period. */
  due?: boolean;
  /** Each payment is (1 + growth) times the one before. */
  growth?: Amount;
  /** Periods before the annuity starts. */
  deferred?: Amount;
}
export function annuity(spec: AnnuitySpec): { presentValue: Rational; futureValue: Rational; total: Rational; payments: number };
export function perpetuity(spec: Omit<AnnuitySpec, "periods">): Rational;

export interface SolvedRate {
  /** A Rational when the root is rational, otherwise an interval that contains exactly one root. */
  rate: Certified;
  exact: boolean;
  text: string;
  multiplicity: number;
}
/** Every rate r > −1 with Σ coefficients[k]·(1 + r)^k = 0, in increasing order. */
export function rateRoots(coefficients: Rational[], options?: Digits & { limit?: number }): SolvedRate[];
export interface TvmProblem extends Digits {
  pv?: Amount;
  fv?: Amount;
  pmt?: Amount;
  rate?: Amount;
  n?: Amount;
  due?: boolean;
}
export type TvmAnswer =
  | { solved: "pv"; pv: Rational; exact: true }
  | { solved: "fv"; fv: Rational; exact: true }
  | { solved: "pmt"; pmt: Rational; exact: true }
  | { solved: "n"; n: Certified; exact: boolean; /** The whole number of periods needed. */ whole: number }
  | { solved: "rate"; rates: SolvedRate[]; /** The rate when there is exactly one. */ rate: Certified | null; count: number };
/** pv + pmt·a + fv·(1 + rate)^−n = 0, money received positive: leave out exactly one of pv, fv, pmt, rate, n. */
export function tvm(problem: TvmProblem): TvmAnswer;

// ---- loans ---------------------------------------------------------------------

export interface LoanSpec {
  principal: Amount;
  /** Nominal annual rate; the rate per period is rate/periodsPerYear. */
  rate: Amount;
  periods?: number;
  periodsPerYear?: Amount;
  /** Fix the payment; then periods may be left out. */
  payment?: Amount;
  rounding?: Rounding;
  extra?: Amount | Record<number, Amount> | ((period: number, balance: Rational) => Amount | undefined);
  interestOnly?: number;
  balloon?: Amount;
  rateChanges?: { from: number; rate: Amount }[];
}
export interface LoanRow {
  period: number;
  /** The rate per period. */
  rate: Rational;
  payment: Rational;
  interest: Rational;
  principal: Rational;
  extra: Rational;
  balance: Rational;
  balloon?: Rational;
}
export interface Loan {
  principal: Rational;
  periodsPerYear: Rational;
  /** The regular (rounded) payment. */
  payment: Rational;
  /** The level payment before rounding, when the loan is a plain one. */
  exactPayment: Rational | null;
  schedule: LoanRow[];
  periods: number;
  finalPayment: Rational;
  balloon: Rational;
  totals: { payments: Rational; interest: Rational; principal: Rational; extra: Rational };
}
export function loan(spec: LoanSpec): Loan;
export function levelPayment(balance: Amount, periodicRate: Amount, periods: number, balloon?: Amount): Rational;
export interface LoanSummary {
  payment: Rational;
  periods: number;
  interest: Rational;
  total: Rational;
}
export function compareLoans(a: Loan | LoanSpec, b: Loan | LoanSpec): { a: LoanSummary; b: LoanSummary; difference: LoanSummary };
export function refinance(
  current: Omit<LoanSpec, "principal"> & { balance: Amount },
  proposed: Omit<LoanSpec, "principal">,
  options?: { costs?: Amount; rollIn?: boolean; rounding?: Rounding },
): { current: Loan; proposed: Loan; costs: Rational; paymentChange: Rational; interestSaved: Rational; totalSaved: Rational; breakEven: number | null; worthIt: boolean };
export function revolving(spec: {
  balance: Amount;
  rate: Amount;
  periodsPerYear?: Amount;
  payment: Amount | { percent?: Amount; minimum?: Amount };
  purchases?: Amount | ((period: number) => Amount | undefined);
  rounding?: Rounding;
  maxPeriods?: number;
}): { schedule: { period: number; interest: Rational; payment: Rational; purchases: Rational; balance: Rational }[]; periods: number; totals: { payments: Rational; interest: Rational } };
export function loanAPR(spec: Digits & { principal: Amount; fees?: Amount; payment: Amount; periods: number; periodsPerYear?: Amount; balloon?: Amount }): { periodic: Certified; nominal: Certified; effective: Certified; exact: boolean };

// ---- cash flows ----------------------------------------------------------------

/** Amounts at times 0, 1, 2, …, or { t, amount } at any exact times. */
export type Flows = Amount[] | { t?: Amount; amount: Amount }[];
export type DatedFlows = { date: DateLike; amount: Amount }[];
export function npv(rate: Amount, flows: Flows, options?: Digits): Certified;
export function xnpv(rate: Amount, flows: DatedFlows, options?: Digits & { dayCount?: DayCount }): Certified;
export interface RatesOfReturn {
  rates: SolvedRate[];
  count: number;
  signChanges: number;
  /** The rate when there is exactly one, else null. */
  rate: Certified | null;
  note: string;
}
/** Every internal rate of return above −100%, with a proven count. */
export function irr(flows: Flows, options?: Digits): RatesOfReturn;
export function xirr(flows: DatedFlows, options?: Digits & { dayCount?: DayCount; range?: [Amount, Amount] }): Omit<RatesOfReturn, "rates"> & { rates: { rate: Certified; exact: boolean; text: string; proven: boolean }[]; formula?: string };
export function mirr(flows: Amount[], financeRate: Amount, reinvestRate: Amount, options?: Digits): Certified;
export function payback(flows: Amount[], options?: { rate?: Amount }): { period: number | null; fractional: Rational | null; cumulative: Rational[] };
export function realValue(nominal: Amount, inflation: Amount, periods: Amount, options?: Digits): Certified;
export function nominalValue(real: Amount, inflation: Amount, periods: Amount, options?: Digits): Certified;
export type DepreciationMethod = "straight-line" | "declining-balance" | "sum-of-years-digits" | "units-of-production";
export const DEPRECIATION: readonly DepreciationMethod[];
export function depreciation(spec: {
  cost: Amount;
  salvage?: Amount;
  life?: number;
  method?: DepreciationMethod;
  /** Declining balance: the rate is factor/life (default 2). */
  factor?: Amount;
  switchToStraightLine?: boolean;
  units?: Amount[];
  totalUnits?: Amount;
  rounding?: Rounding;
}): { period: number; depreciation: Rational; accumulated: Rational; bookValue: Rational }[];
export interface TaxResult {
  tax: Rational;
  marginalRate: Rational;
  averageRate: Rational;
  parts: { from: Rational; to: Rational; rate: Rational; tax: Rational }[];
  afterTax: Rational;
}
/** Brackets in increasing order, the last with no upTo. No jurisdiction's table is built in. */
export function taxSchedule(brackets: { upTo?: Amount | null; rate: Amount }[], options?: { rounding?: Rounding }): { brackets: { upTo: Rational | null; rate: Rational }[]; on(income: Amount): TaxResult };

// ---- bonds and curves ----------------------------------------------------------

export interface BondSpec {
  face?: Amount;
  /** Annual coupon rate. */
  coupon?: Amount;
  /** Coupons a year: 1, 2, 3, 4, 6 or 12 (default 2). */
  frequency?: number;
  redemption?: Amount;
  /** Whole coupon periods left, valued on a coupon date. */
  periods?: number;
  settlement?: DateLike;
  maturity?: DateLike;
  dayCount?: DayCount;
}
export class Bond {
  constructor(spec: BondSpec);
  face: Rational;
  coupon: Rational;
  frequency: number;
  redemption: Rational;
  couponAmount: Rational;
  periods: number;
  accrued: Rational;
  accruedDays: number;
  /** The fraction of a coupon period until the next coupon (1 on a coupon date). */
  first: Rational;
  settlement?: CalendarDate;
  maturity?: CalendarDate;
  readonly cashflows: { t: Rational; years: Rational; amount: Rational; date?: CalendarDate }[];
  /** At a nominal annual yield compounded `frequency` times. Exact on a coupon date. */
  price(yieldRate: Amount, options?: Digits): { dirty: Certified; clean: Certified; accrued: Rational };
  /** The one yield that gives this clean price. */
  yield(cleanPrice: Amount, options?: Digits): Certified;
  duration(yieldRate: Amount): { macaulay: Rational; modified: Rational; convexity: Rational; percentPerPoint: Rational };
}
export function bond(spec: BondSpec | Bond): Bond;
export class YieldCurve {
  constructor(discountFactors: Amount[], frequency?: number);
  discountFactors: Rational[];
  frequency: number;
  readonly periods: number;
  discount(k: number): Rational;
  /** Nominal annual, compounded `frequency` times. */
  spot(k: number, options?: Digits): Certified;
  /** Exact when b = a + 1. */
  forward(a: number, b?: number, options?: Digits): Certified;
  parYield(k: number): Rational;
  price(spec: BondSpec | Bond): Rational;
  readonly spots: Certified[];
  readonly forwards: Certified[];
}
export function yieldCurve(spec: { spots?: Amount[]; discountFactors?: Amount[]; frequency?: number }): YieldCurve;
/** One bond maturing at each of periods 1, 2, 3, …, each with its price. */
export function bootstrap(bonds: (BondSpec & { price: Amount })[], options?: { frequency?: number }): YieldCurve;
export function immunise(problem: { liability: { amount: Amount; time: Amount }; yield: Amount; bonds: [BondSpec | Bond, BondSpec | Bond] }): {
  presentValue: Rational;
  weights: [Rational, Rational];
  amounts: [Rational, Rational];
  units: [Rational, Rational];
  durations: [Rational, Rational];
  convexity: { assets: Rational; liability: Rational };
  /** Both weights are non-negative and the assets are at least as convex as the liability. */
  immunised: boolean;
  short: boolean;
  /** Assets less liability if the yield moves to this value. */
  surplusAt(yieldRate: Amount): Rational;
};

// ---- scenarios -----------------------------------------------------------------

/** A value with its derivative in one chosen input, as handed to a sensitivity `build` function. */
export class Dual {
  constructor(v: Rational, d?: Rational);
  v: Rational;
  d: Rational;
  add(o: Amount | Dual): Dual;
  subtract(o: Amount | Dual): Dual;
  multiply(o: Amount | Dual): Dual;
  divide(o: Amount | Dual): Dual;
  negate(): Dual;
  pow(n: number): Dual;
  compareTo(o: Amount | Dual): number;
  toString(): string;
}
type Input = Amount | Dual;
/** A period number, or a month such as "2028-06" when the scenario has a start. */
export type When = number | string;
export interface AccountSpec {
  name: string;
  balance?: Input;
  /** Annual rate, applied each period as rate/periodsPerYear; a negative balance is charged the same way. */
  rate?: Input;
  rateChanges?: { from: When; rate: Input }[];
}
export interface FlowSpec {
  name?: string;
  amount: Input;
  to?: string;
  from?: string;
  start?: When;
  end?: When;
  /** One period only. */
  at?: When;
  every?: number;
  /** Applied once a year from the flow's start. */
  growth?: Input;
  /** Stop when the `to` account is no longer in debt. */
  until?: "paid";
  /** Where the money goes once that happens. */
  then?: string;
}
export interface ScenarioSpec {
  name?: string;
  periods: number;
  periodsPerYear?: number;
  /** The first period's month, such as "2027-01". */
  start?: DateLike;
  accounts: AccountSpec[];
  flows?: FlowSpec[];
  rounding?: Rounding;
}
export interface ProjectionRow {
  period: number;
  date: string | null;
  balances: Record<string, Rational>;
  interest: Record<string, Rational>;
  flows: Record<string, Rational>;
  netWorth: Rational;
}
export interface Projection {
  name?: string;
  opening: ProjectionRow;
  rows: ProjectionRow[];
  final: Record<string, Rational>;
  netWorth: Rational;
  minimum: Record<string, { balance: Rational; period: number }>;
  firstNegative: { account: string; period: number; date: string | null } | null;
  totals: { interest: Record<string, Rational>; flows: Record<string, Rational> };
  accounts: string[];
}
export class Scenario {
  constructor(spec: ScenarioSpec);
  periods: number;
  periodsPerYear: number;
  /** Each period: interest on the opening balances, then the flows in order. */
  project(): Projection;
}
export function scenario(spec: ScenarioSpec | Scenario): Scenario;
export function compare(
  scenarios: Record<string, ScenarioSpec | Scenario>,
  options?: { measure?: (p: Projection) => Rational },
): {
  rows: { name: string; outcome: Rational; netWorth: Rational; difference: Rational; firstNegative: Projection["firstNegative"]; lowest: { account: string; balance: Rational; period: number } }[];
  best: string;
  series: Record<string, Rational[]>;
  crossovers: { period: number; ahead: string; behind: string }[];
};
/** The exact derivative of the outcome in each input, most influential first. The scenario must be unrounded. */
export function sensitivity<K extends string>(
  build: (inputs: Record<K, Dual>) => ScenarioSpec | Scenario,
  inputs: Record<K, Amount>,
  options?: { measure?: (p: Projection) => Rational | Dual },
): { base: Rational; rows: { input: K; value: Rational; derivative: Rational; perPercent: Rational; elasticity: Rational | null }[]; most: K | null };
