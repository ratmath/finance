// Shared page furniture for the finance docs: the contents column, the theme
// switch and the code boxes. Add each topic page to PAGES as it is written.

import * as A from "./finance.js?v=97c105e03e";
import { mountRunboxes } from "./runbox.js?v=97c105e03e";

export { A };

export const PAGES = [
  { href: "index.html", title: "Overview" },
  { href: "reference.html", title: "Reference" },
  { href: "explore.html", title: "Explore" },
  { group: "Foundations" },
  { href: "money.html", title: "Money and rounding", blurb: "Exact amounts, named rounding rules, splits that add up" },
  { href: "dates.html", title: "Dates and day counts", blurb: "Calendar dates and the conventions for a fraction of a year" },
  { href: "time-value.html", title: "Time value of money", blurb: "Interest, equivalent rates, annuities, solving for what is missing" },
  { group: "Borrowing and investing" },
  { href: "loans.html", title: "Loans", blurb: "Schedules to the cent, extra payments, refinancing, revolving credit" },
  { href: "cash-flows.html", title: "Cash flows", blurb: "Net present value and every internal rate of return" },
  { href: "bonds.html", title: "Bonds", blurb: "Price, yield, accrued interest, duration and convexity" },
  { href: "yield-curves.html", title: "Yield curves", blurb: "Spot and forward rates from bond prices; immunisation" },
  { group: "Simulation" },
  { href: "scenarios.html", title: "Scenarios", blurb: "Exact projection, what-if comparison and sensitivity" },
];

export const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid !== null && kid !== undefined && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return el;
};

// ---- chrome -------------------------------------------------------------------

function theme() {
  let saved = null;
  try {
    saved = localStorage.getItem("ratmath-theme");
  } catch {
    /* storage may be blocked */
  }
  const apply = (t) => {
    if (t === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", t);
    try {
      localStorage.setItem("ratmath-theme", t);
    } catch {
      /* ignore */
    }
    for (const b of document.querySelectorAll(".theme button")) b.classList.toggle("on", b.dataset.t === t);
  };
  if (saved) apply(saved);
  return h("div", { class: "theme", role: "group", "aria-label": "Theme" },
    ["auto", "light", "dark"].map((t) => h("button", { "data-t": t, class: (saved ?? "auto") === t ? "on" : "", onclick: () => apply(t) }, t)));
}

function chrome() {
  const here = location.pathname.split("/").pop() || "index.html";
  const aside = document.querySelector("aside");
  if (!aside) return;
  const nav = h("nav", { class: "toc", "aria-label": "Contents" });
  const sel = h("select", { id: "toc-select", "aria-label": "Page", onchange: (e) => (location.href = e.target.value) });
  let group = null;
  for (const p of PAGES) {
    if (p.group) {
      nav.append(h("div", { class: "group" }, p.group));
      group = h("optgroup", { label: p.group });
      sel.append(group);
      continue;
    }
    nav.append(h("a", { href: p.href, class: p.href === here ? "on" : null, "aria-current": p.href === here ? "page" : null }, p.title));
    (group ?? sel).append(h("option", { value: p.href, selected: p.href === here }, p.title));
  }
  aside.append(
    h("header", { class: "brand" }, h("a", { href: "index.html" }, h("div", { class: "mark" }, "RatMath ", h("span", {}, "finance"))), h("small", {}, "Money, loans and scenarios")),
    sel, nav, theme(),
  );
}

/** Topic cards for the overview page (pages that have a blurb). */
export function topicCards(el) {
  el.append(...PAGES.filter((p) => p.blurb).map((p) => h("a", { href: p.href }, h("strong", {}, p.title), h("span", {}, p.blurb))));
}

chrome();
mountRunboxes(document, { scope: A });
