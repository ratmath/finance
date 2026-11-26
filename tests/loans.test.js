import { expect, test, describe } from "bun:test";
import { Rational, RationalInterval } from "@ratmath/core";
import { loan, levelPayment, compareLoans, refinance, revolving, loanAPR, npv, xnpv, irr, xirr, mirr, payback, realValue, nominalValue, depreciation, taxSchedule, show, FinanceError } from "../index.js";

const q = (s) => new Rational(s);
const code = (f) => {
  try {
    f();
  } catch (e) {
    return e instanceof FinanceError ? e.code : `other: ${e.message}`;
  }
  return "no error";
};
const sum = (xs) => xs.reduce((a, b) => a.add(b), q("0"));

describe("loans", () => {
  test("a schedule adds up to the cent", () => {
    const l = loan({ principal: 250000, rate: "6%", periods: 360 });
    expect(l.payment.toString()).toBe("37472/25"); // 1498.88
    expect(show(l.exactPayment, 6)).toBe("1498.876313");
    expect(l.periods).toBe(360);
    expect(sum(l.schedule.map((r) => r.principal)).toString()).toBe("250000");
    expect(l.schedule[359].balance.toString()).toBe("0");
    expect(show(l.finalPayment, 2)).toBe("1495.22");
    expect(l.totals.payments.equals(l.totals.interest.add(q("250000")))).toBe(true);
    // every row: balance falls by the principal part, and all amounts are whole cents
    let b = q("250000");
    for (const r of l.schedule) {
      expect(r.payment.equals(r.interest.add(r.principal))).toBe(true);
      b = b.subtract(r.principal);
      expect(r.balance.equals(b)).toBe(true);
      expect(r.interest.multiply(q("100")).denominator).toBe(1n);
    }
  });
  test("unrounded schedules end exactly at zero with a level payment", () => {
    const l = loan({ principal: 1000, rate: "12%", periods: 12, rounding: false });
    expect(l.finalPayment.equals(l.payment)).toBe(true);
    expect(l.payment.equals(levelPayment(1000, "1%", 12))).toBe(true);
    expect(loan({ principal: 1200, rate: 0, periods: 12 }).payment.toString()).toBe("100");
  });
  test("extra payments, interest-only, balloon, rate changes", () => {
    const base = loan({ principal: 250000, rate: "6%", periods: 360 });
    const extra = loan({ principal: 250000, rate: "6%", periods: 360, extra: 200 });
    expect(extra.periods).toBe(267);
    expect(extra.totals.interest.compareTo(base.totals.interest) < 0).toBe(true);
    expect(sum(extra.schedule.map((r) => r.principal.add(r.extra))).toString()).toBe("250000");
    const once = loan({ principal: 10000, rate: "6%", periods: 24, extra: { 6: 2000 } });
    expect(once.schedule[5].extra.toString()).toBe("2000");
    expect(once.periods < 24).toBe(true);
    const l = loan({ principal: 100000, rate: "5%", periods: 60, interestOnly: 12, balloon: 20000, rateChanges: [{ from: 25, rate: "7%" }] });
    expect(show(l.schedule[0].payment, 2)).toBe("416.67");
    expect(l.schedule[11].balance.toString()).toBe("100000");
    expect(show(l.schedule[12].payment, 2)).toBe("1925.68");
    expect(l.schedule[24].payment.compareTo(l.schedule[23].payment) > 0).toBe(true);
    expect(l.balloon.toString()).toBe("20000");
    expect(l.schedule[59].balance.toString()).toBe("0");
    expect(l.totals.principal.toString()).toBe("100000");
    const fixed = loan({ principal: 10000, rate: "12%", payment: 500 });
    expect(fixed.periods).toBe(23);
    expect(fixed.finalPayment.compareTo(q("500")) < 0).toBe(true);
    expect(code(() => loan({ principal: 10000, rate: "12%", payment: 50 }))).toBe("negative-amortisation");
    expect(code(() => loan({ principal: 10000, rate: "12%" }))).toBe("bad-loan");
  });
  test("comparing and refinancing", () => {
    const c = compareLoans({ principal: 200000, rate: "6%", periods: 360 }, { principal: 200000, rate: "6%", periods: 180 });
    expect(c.difference.payment.numerator > 0n && c.difference.interest.numerator < 0n).toBe(true);
    const r = refinance({ balance: 200000, rate: "7%", periods: 300 }, { rate: "5.5%", periods: 300 }, { costs: 4000 });
    expect(show(r.paymentChange, 2)).toBe("-185.39");
    expect(r.breakEven).toBe(22);
    expect(r.totalSaved.equals(r.interestSaved.subtract(q("4000")))).toBe(true);
    expect(r.worthIt).toBe(true);
    const rolled = refinance({ balance: 200000, rate: "7%", periods: 300 }, { rate: "6.9%", periods: 300 }, { costs: 4000, rollIn: true });
    expect(rolled.worthIt).toBe(false);
  });
  test("revolving credit", () => {
    const r = revolving({ balance: 3000, rate: "24%", payment: { percent: "3%", minimum: 25 } });
    expect(r.periods).toBe(176);
    expect(r.schedule[r.periods - 1].balance.toString()).toBe("0");
    expect(revolving({ balance: 1000, rate: "24%", payment: 100 }).periods).toBe(12);
    expect(code(() => revolving({ balance: 3000, rate: "24%", payment: 50 }))).toBe("never-repaid");
  });
  test("the rate with fees counted", () => {
    const l = loan({ principal: 250000, rate: "6%", periods: 360 });
    const apr = loanAPR({ principal: 250000, fees: 5000, payment: l.payment, periods: 360 });
    expect(show(apr.nominal, 6)).toBe("0.061895");
    expect(show(apr.effective, 6)).toBe("0.063681");
    const none = loanAPR({ principal: 1000, payment: levelPayment(1000, "1%", 12), periods: 12 });
    expect(none.exact && none.nominal.toString() === "3/25").toBe(true);
  });
});

describe("cash flows", () => {
  const flows = [-1000, 300, 400, 500, 200];
  test("net present value", () => {
    expect(show(npv("10%", flows), 6)).toBe("115.565877");
    expect(npv(0, flows).toString()).toBe("400");
    expect(npv("10%", [{ t: 0, amount: -100 }, { t: 2, amount: 121 }]).toString()).toBe("0");
    const half = npv("21%", [{ t: "1/2", amount: 110 }]);
    expect(half.toString()).toBe("100");
    expect(npv("10%", [{ t: "1/3", amount: 100 }])).toBeInstanceOf(RationalInterval);
    expect(show(xnpv("10%", [{ date: "2027-01-01", amount: -10000 }, { date: "2028-01-01", amount: 11000 }]), 6)).toBe("0.000000");
  });
  test("internal rates of return: all of them", () => {
    const one = irr(flows);
    expect(one.count).toBe(1);
    expect(show(one.rate, 8)).toBe("0.15322138");
    const v = npv(one.rate.low, flows);
    expect(v.numerator >= 0n && npv(one.rate.high, flows).numerator <= 0n).toBe(true);
    const two = irr([-1000, 2300, -1320]);
    expect(two.rates.map((r) => r.text)).toEqual(["1/10", "1/5"]);
    expect(two.rate).toBe(null);
    expect(two.signChanges).toBe(2);
    expect(irr([-1000, 2000, -1500]).count).toBe(0);
    expect(irr([100, 200]).count).toBe(0);
    expect(irr([-100, 110]).rate.toString()).toBe("1/10");
    expect(irr([-4, 12, -9]).rates[0].multiplicity).toBe(2);
    // a long conventional flow goes by bisection
    const long = irr([-100000, ...Array(239).fill(1000), 101000]);
    expect(long.count).toBe(1);
    expect(show(long.rate, 8)).toBe("0.01000000");
  });
  test("dated flows", () => {
    const x = xirr([
      { date: "2027-01-01", amount: -10000 },
      { date: "2027-03-15", amount: 2750 },
      { date: "2027-10-30", amount: 4250 },
      { date: "2028-02-15", amount: 3250 },
      { date: "2028-04-01", amount: 2750 },
    ]);
    expect(x.count).toBe(1);
    expect(show(x.rate, 6)).toBe("0.369213");
    expect(xirr([{ date: "2027-01-01", amount: 5 }, { date: "2027-06-01", amount: 5 }]).count).toBe(0);
  });
  test("modified rate, payback, inflation", () => {
    expect(show(mirr(flows, "8%", "6%"), 6)).toBe("0.113398");
    expect(mirr([-100, 0, 121], "5%", "5%").toString()).toBe("1/10");
    const p = payback(flows);
    expect(p.period).toBe(3);
    expect(p.fractional.toString()).toBe("13/5");
    expect(payback([-1000, 100, 100]).period).toBe(null);
    expect(payback(flows, { rate: "10%" }).period).toBe(4);
    expect(realValue(1210, "10%", 2).toString()).toBe("1000");
    expect(nominalValue(1000, "10%", 2).toString()).toBe("1210");
  });
  test("depreciation", () => {
    const amounts = (o) => depreciation({ cost: 10000, salvage: 1000, life: 5, ...o }).map((r) => r.depreciation.toString());
    expect(amounts({})).toEqual(["1800", "1800", "1800", "1800", "1800"]);
    expect(amounts({ method: "declining-balance" })).toEqual(["4000", "2400", "1440", "864", "296"]);
    expect(amounts({ method: "sum-of-years-digits" })).toEqual(["3000", "2400", "1800", "1200", "600"]);
    expect(depreciation({ cost: 10000, salvage: 1000, method: "units-of-production", units: [100, 300, 200] }).map((r) => r.depreciation.toString())).toEqual(["1500", "4500", "3000"]);
    const rounded = depreciation({ cost: 1000, life: 3, rounding: 2 });
    expect(rounded.map((r) => r.depreciation.toString())).toEqual(["33333/100", "33333/100", "16667/50"]);
    expect(rounded[2].bookValue.toString()).toBe("0");
    const sw = depreciation({ cost: 10000, salvage: 0, life: 5, method: "declining-balance", switchToStraightLine: true });
    expect(sw[4].bookValue.toString()).toBe("0");
    expect(code(() => depreciation({ cost: 1, life: 3, method: "magic" }))).toBe("bad-method");
  });
  test("brackets supplied by the caller", () => {
    const t = taxSchedule([{ upTo: 10000, rate: "10%" }, { upTo: 40000, rate: "20%" }, { rate: "30%" }]);
    const r = t.on(55000);
    expect(r.tax.toString()).toBe("11500");
    expect(r.marginalRate.toString()).toBe("3/10");
    expect(r.averageRate.toString()).toBe("23/110");
    expect(r.parts.length).toBe(3);
    expect(t.on(10000).tax.toString()).toBe("1000");
    expect(t.on(0).tax.toString()).toBe("0");
    expect(code(() => taxSchedule([{ upTo: 10, rate: "10%" }]))).toBe("bad-brackets");
  });
});
