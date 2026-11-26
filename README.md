# @ratmath/finance

The mathematics of finance for [RatMath](https://ratmath.com/), part of the
[RatMath Shelf](https://ratmath.com/shelf/). Docs: [ratmath.com/finance](https://ratmath.com/finance/).

Amounts are exact rationals. Rounding happens only where a named rule says
so, so a schedule adds up to the cent and its last payment is adjusted
visibly. A rate found by solving an equation is proven, and when a cash flow
has two rates of return, or none, that is the answer. A scenario is projected
exactly, so comparisons and sensitivities are exact too.

```js
import { loan, irr, bond, bootstrap, scenario, sensitivity, round, show } from "@ratmath/finance";

const l = loan({ principal: 250000, rate: "6%", periods: 360 });
show(l.payment, 2);                       // "1498.88"
show(l.finalPayment, 2);                  // "1495.22"
show(l.totals.interest, 2);               // "289593.14"

irr([-1000, 2300, -1320]).rates.map((r) => r.text);   // ["1/10", "1/5"]
irr([-1000, 2000, -1500]).count;                      // 0, proven

const b = bond({ coupon: "5%", periods: 20 });
show(b.price("6%").clean, 6);             // "92.561263"
b.yield(100);                             // 1/20, exactly

scenario({
  periods: 120,
  accounts: [{ name: "savings", balance: 10000, rate: "4%" }],
  flows: [{ amount: 500, to: "savings", growth: "2%" }],
}).project().netWorth;                    // an exact fraction

round("2.345");                           // 2.34 (half-even); { mode: "half-up" } gives 2.35
```

No market data, no tax tables and no advice are built in. The caller supplies
the numbers.

## What is built

| Area | Functions |
|---|---|
| Money and rounding | `amount`, `round` (seven named modes), `format`, `show`, `allocate` |
| Dates | `date`, `daysBetween`, `dayCount` (30/360, 30E/360, actual/360, actual/365, actual/actual) |
| Time value | `simpleInterest`, `compound`, `effectiveRate`, `nominalRate`, `equivalentRate`, `realRate`, `presentValue`, `futureValue`, `annuity`, `perpetuity`, `tvm` (solves for the missing quantity) |
| Loans | `loan` (extra payments, interest-only, balloon, rate changes), `levelPayment`, `compareLoans`, `refinance`, `loanAPR`, `revolving` |
| Cash flows | `npv`, `xnpv`, `irr` (every rate), `xirr`, `mirr`, `payback`, `realValue`, `nominalValue`, `depreciation`, `taxSchedule` |
| Bonds and rates | `bond` (price, yield, accrued interest, duration, convexity), `bootstrap`, `yieldCurve` (spot, forward, par yield), `immunise` |
| Scenarios | `scenario` and `.project()`, `compare`, `sensitivity` (exact derivatives) |
| Uncertain inputs | `processes` (fixed, independent, choice, sequence, resample, gbm, walk, meanReverting), `simulate` (seeded runs: ruin with an exact interval, percentiles, bands, real values, random events), `sequenceRisk` |
| Portfolios | `portfolio` (frontier exactly, long-only with a KKT certificate, tangency), `capm`, `returnsFrom` |
| Options | `strategy` (exact break-evens), `parity`, `binomialTree` (exact, European or American), `blackScholes` and `impliedVolatility` (certified) |
| Life contingencies | `lifeTable`, `deMoivre`, `lifeAnnuity`, `lifeInsurance`, `pureEndowment`, `endowment`, `netPremium`, `reserve` |

Results are Core `Rational`s when exact, and `RationalInterval`s proven to
contain the value when a root or an exponential is involved. Simulated
results carry their seed and their sampling error.

## Still planned

| Phase | Contents |
|---|---|
| 7 | Pictures |

The plan is in the
[library roadmap](https://github.com/ratmath/ratmath/blob/main/docs/design/library-roadmap.md#12-a-finance-package-ratmathfinance),
and `plan` exports the list.

## Layout

- `index.js`, `src/`: the library. `money.js` (amounts, rounding, dates),
  `solve.js` (rates as roots), `tvm.js`, `loans.js`, `cashflow.js`,
  `bonds.js`, `scenario.js`, `uncertain.js`, `portfolio.js`, `options.js`,
  `life.js`, `plan.js`.
- `vendor/analytic`, `vendor/algebraic`, `vendor/stats`, `vendor/discrete`:
  git submodules, used as workspaces.
  Clone with `--recurse-submodules`.
- `tests/`: `bun run test`.
- `docs/src/*.html`: the docs pages. `bun run docs:build` writes `docs/`,
  typesets the mathematics and runs the code box at the end of every page.
  `docs/*.html` and `docs/assets/finance.js` are build output.
- `docs/assets/runbox.js` and `scripts/docs-kit.js` are shared with the other
  RatMath docs sites and should be kept in step with them.

## Development

```sh
git submodule update --init
bun install
bun run test
bun run docs:build
```

MIT licensed.
