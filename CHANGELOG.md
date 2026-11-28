# Changelog

## Unreleased

- Money rounding is built on Core 0.12's `rounding()`: `round`, `format` and
  every `rounding` option now also take any Core mode name (`half-odd`,
  `toward-zero`, ...), a Core rounder, or your own function given
  `{ value, floor, ceil, fraction }`. The default stays half-even (banker's
  rounding, usual in accounting software) and lives in one exported constant,
  `MONEY_ROUNDING`; `moneyRounder(mode)` returns the Core rounder for a mode.
  Core's own default is half-up; finance keeps half-even on purpose.
- Requires Core 0.12: the `@ratmath/core` peer range is now `>=0.12.0` (Core 0.12 returns Integers from `floor`/`ceil`/`trunc`/`round` and rounds half up by default).
- `parity` takes enclosed prices: the call (or put) that `blackScholes`
  returns goes straight in, and the missing price comes back enclosed. It used
  to refuse with "cannot read … as an exact amount". Found by the Course Test
  (ratmath/shelf#7).
- `@ratmath/core` is now a peer dependency (`>=0.10.0 <0.12.0`): the package
  uses the program's own copy of Core instead of bringing its own, so Core 0.11
  works and there is never a second copy whose `Rational` is not the same class.

## 0.2.0

- Uncertain inputs and repeated runs (roadmap phase 5): `processes` turn a
  seeded stream into a path of growth factors (fixed, independent draws from
  a `@ratmath/stats` distribution, a weighted choice, a given sequence,
  block resampling of supplied history, geometric Brownian motion, a random
  walk and a mean-reverting rate); `simulate` writes the paths, inflation
  indexing and random one-off events into a scenario and projects it many
  times, reporting the chance of ruin with an exact interval, percentiles,
  bands over time and real values; `sequenceRisk` shows the effect of the
  order of good and bad years (none, exactly, without flows). Scenarios gain
  per-period `rates` on accounts and an `index` on flows.
- Portfolios, options and life contingencies (phase 6): `portfolio` with the
  efficient frontier in closed form, the long-only frontier with a KKT
  certificate, the tangency portfolio and its Sharpe ratio; `capm`;
  `strategy` payoffs with exact break-even prices; `parity`; `binomialTree`
  (exact European and American prices, Cox–Ross–Rubinstein from a
  volatility, a floating-point preview); `blackScholes` with every
  sensitivity enclosed and `impliedVolatility` by certified bisection; life
  tables (`lifeTable`, `deMoivre`), `lifeAnnuity`, `lifeInsurance`,
  `pureEndowment`, `endowment`, `netPremium` and `reserve`, all exact.
- Depends on `@ratmath/stats` (and through it `@ratmath/discrete`), vendored.

## 0.1.0

- Money and time value (roadmap phase 1): exact `amount`s, `round` with seven
  named rules, `format`, `allocate`; calendar dates and five day-count
  conventions; simple, compound and continuous interest; equivalent rates;
  present and future value; level, growing, due and deferred annuities;
  perpetuities; `tvm`, which solves for whichever of the five quantities is
  left out.
- Loans and cash flows (phase 2): `loan` schedules to the cent with extra
  payments, interest-only periods, balloons and rate changes; `compareLoans`,
  `refinance`, `loanAPR`, `revolving`; `npv` and `xnpv`; `irr`, which returns
  every internal rate of return with a proven count, and `xirr` for dated
  flows; `mirr`, `payback`, inflation, `depreciation` by four methods and
  `taxSchedule` from brackets the caller supplies.
- Bonds and rates (phase 3): `bond` with price, yield to maturity, accrued
  interest, duration and convexity, on or between coupon dates; `bootstrap`
  and `yieldCurve` with spot, forward and par rates; `immunise`.
- Scenarios (phase 4): `scenario` projects accounts and flows exactly;
  `compare` sets scenarios side by side; `sensitivity` gives the exact
  derivative of the outcome in each input.
- Docs: overview, explore, reference and eight topic pages.
