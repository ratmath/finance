# Changelog

## Unreleased

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
