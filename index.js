// @ratmath/finance: the mathematics of finance with exact money.
//
// Amounts are rationals and are rounded only where a rule says so; rates
// found by solving are proven, and every one of them is reported; a
// scenario is projected exactly, so comparisons and sensitivities are exact.

export { plan } from "./src/plan.js";
export { FinanceError, amount, rate, round, format, allocate, power, exp, ln, show, CalendarDate, date, daysBetween, dayCount, isLeap, DAY_COUNTS } from "./src/money.js";
export { simpleInterest, compound, effectiveRate, nominalRate, equivalentRate, realRate, discountFactor, futureValue, presentValue, annuity, perpetuity, tvm } from "./src/tvm.js";
export { rateRoots } from "./src/solve.js";
export { loan, levelPayment, compareLoans, refinance, revolving, loanAPR } from "./src/loans.js";
export { npv, xnpv, irr, xirr, mirr, payback, realValue, nominalValue, depreciation, DEPRECIATION, taxSchedule } from "./src/cashflow.js";
export { Bond, bond, YieldCurve, yieldCurve, bootstrap, immunise } from "./src/bonds.js";
export { Scenario, scenario, compare, sensitivity, Dual } from "./src/scenario.js";
