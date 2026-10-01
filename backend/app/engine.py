"""Core FX-exposure analytics.

Conventions
-----------
* All amounts are USD billions at today's spot rate.
* A currency move ``m`` is the % change in the value of the foreign currency
  measured in USD (as a decimal). ``m = -0.10`` means the currency lost 10%
  against the dollar — equivalently, a stronger dollar.
* Net exposure per currency ``N_c = revenue_c - cost_c``. A long position
  (N > 0) loses money when the foreign currency weakens.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from .market import FOREIGN, POLICY_RATES, MarketData

DATA_DIR = Path(__file__).parent / "data"


# --------------------------------------------------------------------------- #
# Data loading
# --------------------------------------------------------------------------- #
@dataclass
class Company:
    ticker: str
    name: str
    sector: str
    blurb: str
    revenue: float
    op_margin: float
    tax_rate: float
    debt: float
    floating_share: float
    refi_share: float
    avg_rate: float
    net_debt: float
    fcf: float
    shares: float
    wacc: float
    growth: float
    revenue_mix: dict[str, float]
    cost_mix: dict[str, float]

    @property
    def op_income(self) -> float:
        return self.revenue * self.op_margin

    @property
    def costs(self) -> float:
        return self.revenue - self.op_income

    def exposure(self) -> dict[str, dict[str, float]]:
        """Revenue, cost and net exposure in USD bn by foreign currency."""
        out = {}
        for c in FOREIGN:
            rev = self.revenue * self.revenue_mix.get(c, 0.0)
            cost = self.costs * self.cost_mix.get(c, 0.0)
            out[c] = {"revenue": rev, "cost": cost, "net": rev - cost}
        return out

    def net_vec(self) -> np.ndarray:
        exp = self.exposure()
        return np.array([exp[c]["net"] for c in FOREIGN])

    def public(self) -> dict:
        exp = self.exposure()
        return {
            **self.__dict__,
            "op_income": self.op_income,
            "foreign_revenue_share": 1 - self.revenue_mix.get("USD", 0.0),
            "exposure": exp,
        }


def _normalise(mix: dict[str, float]) -> dict[str, float]:
    total = sum(mix.values())
    return {k: v / total for k, v in mix.items()} if total else mix


def load_companies() -> dict[str, Company]:
    raw = json.loads((DATA_DIR / "companies.json").read_text())["companies"]
    out = {}
    for r in raw:
        r["revenue_mix"] = _normalise(r["revenue_mix"])
        r["cost_mix"] = _normalise(r["cost_mix"])
        out[r["ticker"]] = Company(**r)
    return out


def load_scenarios() -> list[dict]:
    return json.loads((DATA_DIR / "scenarios.json").read_text())["scenarios"]


# --------------------------------------------------------------------------- #
# Hedging
# --------------------------------------------------------------------------- #
def option_premium_rate(sigma: float, horizon: float) -> float:
    """ATM option premium as a fraction of notional (Brenner–Subrahmanyam)."""
    return 0.4 * sigma * np.sqrt(horizon)


def hedge_pnl(net, m, ratio, instrument: str, sigma: float, ccy: str, horizon: float):
    """P&L (USD bn) of hedging ``ratio`` of net exposure ``net`` given move ``m``.

    Works element-wise on numpy arrays of moves (for Monte Carlo).

    * forward: locks today's forward rate. Gains offset the underlying move;
      cost is the interest-rate differential (forward points).
    * option: buys ATM protection — a put on the currency if long, a call if
      short. Keeps upside, costs an up-front premium.
    """
    if instrument == "none" or ratio <= 0 or net == 0:
        return np.zeros_like(np.asarray(m, dtype=float))
    m = np.asarray(m, dtype=float)
    notional = ratio * net
    if instrument == "forward":
        carry = (POLICY_RATES.get(ccy, 0.0) - POLICY_RATES["USD"]) * horizon
        return -notional * m - notional * carry
    if instrument == "option":
        payoff = abs(notional) * np.maximum(-np.sign(net) * m, 0.0)
        premium = abs(notional) * option_premium_rate(sigma, horizon)
        return payoff - premium
    raise ValueError(f"unknown instrument {instrument}")


def hedge_cost(net: float, ratio: float, instrument: str, sigma: float, ccy: str, horizon: float) -> float:
    """Expected cost of a hedge (positive = costs money) when the currency doesn't move."""
    return float(-hedge_pnl(net, 0.0, ratio, instrument, sigma, ccy, horizon))


def _hedge_for(hedges: dict, ccy: str) -> tuple[float, str]:
    h = hedges.get(ccy) or {}
    return float(h.get("ratio", 0.0)), str(h.get("instrument", "none"))


# --------------------------------------------------------------------------- #
# Scenario analysis
# --------------------------------------------------------------------------- #
def scenario_impact(co: Company, moves_pct: dict[str, float], hedges: dict, market: MarketData,
                    horizon: float = 1.0) -> dict:
    """Deterministic P&L impact of a set of currency moves (in %)."""
    exp = co.exposure()
    rows = []
    tot_rev = tot_cost = tot_hedge = 0.0
    for c in FOREIGN:
        m = moves_pct.get(c, 0.0) / 100
        e = exp[c]
        ratio, inst = _hedge_for(hedges, c)
        hp = float(hedge_pnl(e["net"], m, ratio, inst, market.vol[c], c, horizon))
        d_rev, d_cost = e["revenue"] * m, e["cost"] * m
        tot_rev += d_rev
        tot_cost += d_cost
        tot_hedge += hp
        rows.append({
            "ccy": c, "move": m * 100, "d_revenue": d_rev, "d_cost": d_cost,
            "d_op": d_rev - d_cost, "hedge_pnl": hp, "d_op_hedged": d_rev - d_cost + hp,
        })
    d_op = tot_rev - tot_cost
    base_op = co.op_income
    return {
        "rows": rows,
        "d_revenue": tot_rev,
        "d_cost": tot_cost,
        "d_op": d_op,
        "hedge_pnl": tot_hedge,
        "d_op_hedged": d_op + tot_hedge,
        "revenue_after": co.revenue + tot_rev,
        "op_after": base_op + d_op + tot_hedge,
        "d_revenue_pct": tot_rev / co.revenue * 100,
        "d_op_pct": d_op / base_op * 100,
        "d_op_hedged_pct": (d_op + tot_hedge) / base_op * 100,
    }


def tornado(co: Company, hedges: dict, market: MarketData, shock_pct: float = 10.0, horizon: float = 1.0) -> list[dict]:
    """Op-income impact of ±shock in each currency individually, sorted by size."""
    out = []
    for c in FOREIGN:
        up = scenario_impact(co, {c: shock_pct}, hedges, market, horizon)
        dn = scenario_impact(co, {c: -shock_pct}, hedges, market, horizon)
        out.append({
            "ccy": c,
            "up": up["d_op"], "down": dn["d_op"],
            "up_hedged": up["d_op_hedged"], "down_hedged": dn["d_op_hedged"],
        })
    out.sort(key=lambda r: abs(r["up"]) + abs(r["down"]), reverse=True)
    return out


def uniform_usd_moves(usd_pct: float) -> dict[str, float]:
    """Moves for a broad USD move of ``usd_pct`` (positive = stronger dollar)."""
    m = (1 / (1 + usd_pct / 100) - 1) * 100
    return {c: m for c in FOREIGN}


# --------------------------------------------------------------------------- #
# Monte Carlo
# --------------------------------------------------------------------------- #
def simulate_moves(market: MarketData, n_paths: int, horizon: float, seed: int) -> np.ndarray:
    """Correlated lognormal currency moves over ``horizon`` years, shape (n, k)."""
    rng = np.random.default_rng(seed)
    cov = market.cov_mat * horizon
    chol = np.linalg.cholesky(cov + np.eye(len(FOREIGN)) * 1e-12)
    z = rng.standard_normal((n_paths, len(FOREIGN)))
    drift = -0.5 * np.diag(cov)
    return np.expm1(z @ chol.T + drift)


def _pnl_matrix(co: Company, moves: np.ndarray, hedges: dict, market: MarketData, horizon: float):
    net = co.net_vec()
    unhedged = moves * net  # (n, k) per-currency op-income change
    hedged = unhedged.copy()
    for j, c in enumerate(FOREIGN):
        ratio, inst = _hedge_for(hedges, c)
        hedged[:, j] += hedge_pnl(net[j], moves[:, j], ratio, inst, market.vol[c], c, horizon)
    return unhedged, hedged


def _risk_stats(pnl: np.ndarray, base_op: float) -> dict:
    pct = pnl / base_op * 100
    q5 = np.percentile(pct, 5)
    q1 = np.percentile(pct, 1)
    tail = pct[pct <= q5]
    return {
        "mean": float(pct.mean()),
        "std": float(pct.std()),
        "var95": float(-q5),
        "var99": float(-q1),
        "cvar95": float(-tail.mean()) if tail.size else float(-q5),
        "p_loss_5": float((pct < -5).mean() * 100),
        "p_gain_5": float((pct > 5).mean() * 100),
        "var95_usd": float(-np.percentile(pnl, 5)),
        "percentiles": {str(p): float(np.percentile(pct, p)) for p in (1, 5, 25, 50, 75, 95, 99)},
    }


def _risk_contrib(per_ccy: np.ndarray) -> list[dict]:
    total = per_ccy.sum(axis=1)
    var = total.var()
    if var <= 0:
        return [{"ccy": c, "share": 0.0} for c in FOREIGN]
    out = []
    for j, c in enumerate(FOREIGN):
        cov = np.cov(per_ccy[:, j], total, bias=True)[0, 1]
        out.append({"ccy": c, "share": float(cov / var * 100)})
    out.sort(key=lambda r: r["share"], reverse=True)
    return out


def monte_carlo(co: Company, hedges: dict, market: MarketData, n_paths: int = 10000,
                horizon: float = 1.0, seed: int = 7, bins: int = 60) -> dict:
    moves = simulate_moves(market, n_paths, horizon, seed)
    un, he = _pnl_matrix(co, moves, hedges, market, horizon)
    un_tot, he_tot = un.sum(axis=1), he.sum(axis=1)
    base = co.op_income

    un_pct, he_pct = un_tot / base * 100, he_tot / base * 100
    lo = min(np.percentile(un_pct, 0.2), np.percentile(he_pct, 0.2))
    hi = max(np.percentile(un_pct, 99.8), np.percentile(he_pct, 99.8))
    edges = np.linspace(lo, hi, bins + 1)
    h_un, _ = np.histogram(np.clip(un_pct, lo, hi), edges)
    h_he, _ = np.histogram(np.clip(he_pct, lo, hi), edges)
    mids = (edges[:-1] + edges[1:]) / 2

    # Fan chart: a few sample paths of a broad dollar index not needed; give
    # percentile bands for op income in USD instead.
    return {
        "n_paths": n_paths,
        "horizon": horizon,
        "base_op": base,
        "histogram": [
            {"x": float(x), "unhedged": int(a), "hedged": int(b)}
            for x, a, b in zip(mids, h_un, h_he)
        ],
        "unhedged": _risk_stats(un_tot, base),
        "hedged": _risk_stats(he_tot, base),
        "risk_contrib": _risk_contrib(un),
        "risk_contrib_hedged": _risk_contrib(he),
        "hedge_cost": float(-(he_tot - un_tot).mean()),
    }


def hedge_frontier(co: Company, market: MarketData, horizon: float = 1.0, n_paths: int = 6000, seed: int = 11) -> dict:
    """VaR vs expected cost as the hedge ratio sweeps 0→100% for each instrument."""
    moves = simulate_moves(market, n_paths, horizon, seed)  # common random numbers
    base = co.op_income
    out = {}
    for inst in ("forward", "option"):
        pts = []
        for ratio in np.linspace(0, 1, 11):
            hedges = {c: {"ratio": float(ratio), "instrument": inst} for c in FOREIGN}
            un, he = _pnl_matrix(co, moves, hedges, market, horizon)
            he_tot = he.sum(axis=1)
            cost = sum(hedge_cost(co.net_vec()[j], ratio, inst, market.vol[c], c, horizon) for j, c in enumerate(FOREIGN))
            pts.append({
                "ratio": round(float(ratio) * 100),
                "var95": float(-np.percentile(he_tot / base * 100, 5)),
                "std": float((he_tot / base * 100).std()),
                "cost": float(cost),
                "cost_pct": float(cost / base * 100),
            })
        out[inst] = pts
    return out


# --------------------------------------------------------------------------- #
# Interest rates & valuation
# --------------------------------------------------------------------------- #
# Only part of a risk-free move reaches WACC: debt is a minority of capital and
# equity risk premia tend to widen when rates fall in a crisis (and compress
# when they rise in a boom).
RATE_PASSTHROUGH = 0.5

def valuation(co: Company, d_op: float = 0.0, rate_bps: float = 0.0) -> dict:
    """Perpetuity-growth DCF with an FX op-income shock and a parallel rate shift.

    Returns a step-by-step bridge: base → FX → interest expense → discount rate.
    """
    dr = rate_bps / 10_000
    repriced = min(1.0, co.floating_share + co.refi_share)
    d_interest = co.debt * repriced * dr
    t = co.tax_rate

    def ev(fcf: float, wacc: float) -> float:
        spread = max(wacc - co.growth, 0.01)
        return fcf * (1 + co.growth) / spread

    def per_share(e: float) -> float:
        return (e - co.net_debt) / co.shares

    fcf_base = co.fcf
    fcf_fx = fcf_base + d_op * (1 - t)
    fcf_all = fcf_fx - d_interest * (1 - t)
    wacc_new = co.wacc + dr * RATE_PASSTHROUGH

    ev_base = ev(fcf_base, co.wacc)
    ev_fx = ev(fcf_fx, co.wacc)
    ev_int = ev(fcf_all, co.wacc)
    ev_new = ev(fcf_all, wacc_new)

    ps_base, ps_fx, ps_int, ps_new = (per_share(x) for x in (ev_base, ev_fx, ev_int, ev_new))

    interest_base = co.debt * co.avg_rate
    ni_base = (co.op_income - interest_base) * (1 - t)
    ni_new = (co.op_income + d_op - interest_base - d_interest) * (1 - t)

    return {
        "rate_bps": rate_bps,
        "repriced_share": repriced,
        "d_interest": d_interest,
        "interest_base": interest_base,
        "fcf_base": fcf_base,
        "fcf_new": fcf_all,
        "wacc_base": co.wacc,
        "wacc_new": wacc_new,
        "ev_base": ev_base,
        "ev_new": ev_new,
        "per_share_base": ps_base,
        "per_share_new": ps_new,
        "value_change_pct": (ps_new / ps_base - 1) * 100 if ps_base else 0.0,
        "eps_base": ni_base / co.shares,
        "eps_new": ni_new / co.shares,
        "eps_change_pct": (ni_new / ni_base - 1) * 100 if ni_base else 0.0,
        "bridge": [
            {"step": "Base", "value": ps_base},
            {"step": "FX → FCF", "value": ps_fx - ps_base},
            {"step": "Interest", "value": ps_int - ps_fx},
            {"step": "Discount rate", "value": ps_new - ps_int},
            {"step": "Shocked", "value": ps_new},
        ],
    }


def macro_surface(co: Company, hedges: dict, market: MarketData,
                  usd_moves=(-20, -15, -10, -5, 0, 5, 10, 15, 20),
                  rate_moves=(-200, -100, -50, 0, 50, 100, 200, 300)) -> dict:
    """Equity value % change on a grid of (broad USD move × rate shock)."""
    grid = []
    for r in rate_moves:
        row = []
        for u in usd_moves:
            imp = scenario_impact(co, uniform_usd_moves(u), hedges, market)
            v = valuation(co, imp["d_op_hedged"], r)
            row.append(round(v["value_change_pct"], 3))
        grid.append(row)
    return {"usd_moves": list(usd_moves), "rate_moves": list(rate_moves), "grid": grid}


# --------------------------------------------------------------------------- #
# Narrative + comparison
# --------------------------------------------------------------------------- #
def _fmt_bn(x: float) -> str:
    return f"${abs(x):.2f}bn" if abs(x) >= 1 else f"${abs(x) * 1000:.0f}m"


def narrative(co: Company, market: MarketData, mc: dict | None = None) -> list[str]:
    exp = co.exposure()
    usd10 = scenario_impact(co, uniform_usd_moves(10), {}, market)
    top = sorted(FOREIGN, key=lambda c: abs(exp[c]["net"]), reverse=True)[:2]
    foreign_share = (1 - co.revenue_mix.get("USD", 0)) * 100
    foreign_cost = (1 - co.cost_mix.get("USD", 0)) * 100
    natural = sum(min(exp[c]["revenue"], exp[c]["cost"]) for c in FOREIGN)
    foreign_rev = sum(exp[c]["revenue"] for c in FOREIGN)
    lines = [
        f"{co.name} earns about {foreign_share:.0f}% of revenue outside the US but incurs only "
        f"{foreign_cost:.0f}% of its costs abroad, so roughly {natural / foreign_rev * 100:.0f}% of foreign "
        f"revenue is naturally hedged by local costs." if foreign_rev else f"{co.name} is almost entirely domestic.",
        f"A broad 10% rally in the US dollar would cut operating income by about "
        f"{_fmt_bn(usd10['d_op'])} ({abs(usd10['d_op_pct']):.1f}%), "
        f"with revenue falling {abs(usd10['d_revenue_pct']):.1f}%.",
        f"The largest unhedged exposures are {top[0]} ({_fmt_bn(exp[top[0]]['net'])} net) and "
        f"{top[1]} ({_fmt_bn(exp[top[1]]['net'])} net).",
    ]
    if mc:
        rc = mc["risk_contrib"][0]
        lines.append(
            f"Across {mc['n_paths']:,} simulated one-year currency paths, there is a 5% chance FX knocks at least "
            f"{mc['unhedged']['var95']:.1f}% off operating income; {rc['ccy']} drives {rc['share']:.0f}% of that risk."
        )
    return lines


def compare(companies: list[Company], market: MarketData) -> list[dict]:
    rows = []
    for co in companies:
        exp = co.exposure()
        mc = monte_carlo(co, {}, market, n_paths=4000, bins=10)
        usd10 = scenario_impact(co, uniform_usd_moves(10), {}, market)
        v100 = valuation(co, 0, 100)
        gross_net = sum(abs(exp[c]["net"]) for c in FOREIGN)
        rows.append({
            "ticker": co.ticker,
            "name": co.name,
            "sector": co.sector,
            "foreign_revenue_share": (1 - co.revenue_mix.get("USD", 0)) * 100,
            "usd10_op_pct": usd10["d_op_pct"],
            "var95": mc["unhedged"]["var95"],
            "top_ccy": mc["risk_contrib"][0]["ccy"],
            "net_exposure_ratio": gross_net / co.op_income * 100,
            "rate100_value_pct": v100["value_change_pct"],
            "op_margin": co.op_margin * 100,
        })
    return rows
