from __future__ import annotations

from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import engine
from .market import FOREIGN, get_market

app = FastAPI(
    title="FX Exposure Lab API",
    description="Currency exposure, Monte Carlo risk, hedging and rate-sensitivity analytics for multinationals.",
    version="1.0.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

COMPANIES = engine.load_companies()
SCENARIOS = engine.load_scenarios()


# --------------------------------------------------------------------------- #
# Schemas
# --------------------------------------------------------------------------- #
class Hedge(BaseModel):
    ratio: float = Field(0.0, ge=0.0, le=1.0)
    instrument: Literal["none", "forward", "option"] = "none"


class AnalyzeRequest(BaseModel):
    ticker: str
    moves: dict[str, float] = Field(default_factory=dict, description="% move of each currency vs USD")
    hedges: dict[str, Hedge] = Field(default_factory=dict)
    rate_bps: float = 0.0
    horizon: float = Field(1.0, gt=0, le=3)


class SimRequest(BaseModel):
    ticker: str
    hedges: dict[str, Hedge] = Field(default_factory=dict)
    n_paths: int = Field(10_000, ge=500, le=50_000)
    horizon: float = Field(1.0, gt=0, le=3)
    seed: int = 7


class TickerHedges(BaseModel):
    ticker: str
    hedges: dict[str, Hedge] = Field(default_factory=dict)
    horizon: float = Field(1.0, gt=0, le=3)


class CompareRequest(BaseModel):
    tickers: list[str]


def _company(ticker: str) -> engine.Company:
    co = COMPANIES.get(ticker.upper())
    if not co:
        raise HTTPException(404, f"Unknown ticker {ticker}")
    return co


def _h(hedges: dict[str, Hedge]) -> dict:
    return {k: v.model_dump() for k, v in hedges.items() if k in FOREIGN}


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #
@app.get("/api/health")
def health():
    m = get_market()
    return {"status": "ok", "market_source": m.source, "as_of": m.as_of}


@app.get("/api/market")
def market(refresh: bool = False):
    return get_market(force=refresh).to_public()


@app.get("/api/companies")
def companies():
    return [
        {
            "ticker": c.ticker, "name": c.name, "sector": c.sector, "revenue": c.revenue,
            "foreign_revenue_share": 1 - c.revenue_mix.get("USD", 0.0),
        }
        for c in COMPANIES.values()
    ]


@app.get("/api/companies/{ticker}")
def company(ticker: str):
    co = _company(ticker)
    m = get_market()
    mc = engine.monte_carlo(co, {}, m, n_paths=6000)
    return {
        **co.public(),
        "narrative": engine.narrative(co, m, mc),
        "var95": mc["unhedged"]["var95"],
        "usd10": engine.scenario_impact(co, engine.uniform_usd_moves(10), {}, m),
    }


@app.get("/api/scenarios")
def scenarios():
    return SCENARIOS


@app.post("/api/analyze")
def analyze(req: AnalyzeRequest):
    co = _company(req.ticker)
    m = get_market()
    hedges = _h(req.hedges)
    impact = engine.scenario_impact(co, req.moves, hedges, m, req.horizon)
    hedge_rows = []
    exp = co.exposure()
    for c in FOREIGN:
        h = hedges.get(c, {"ratio": 0.0, "instrument": "none"})
        hedge_rows.append({
            "ccy": c,
            "net": exp[c]["net"],
            "ratio": h["ratio"],
            "instrument": h["instrument"],
            "cost": engine.hedge_cost(exp[c]["net"], h["ratio"], h["instrument"], m.vol[c], c, req.horizon),
            "vol": m.vol[c],
        })
    return {
        "impact": impact,
        "tornado": engine.tornado(co, hedges, m, 10.0, req.horizon),
        "valuation": engine.valuation(co, impact["d_op_hedged"], req.rate_bps),
        "hedges": hedge_rows,
        "total_hedge_cost": sum(r["cost"] for r in hedge_rows),
    }


@app.post("/api/simulate")
def simulate(req: SimRequest):
    co = _company(req.ticker)
    return engine.monte_carlo(co, _h(req.hedges), get_market(), req.n_paths, req.horizon, req.seed)


@app.post("/api/frontier")
def frontier(req: TickerHedges):
    co = _company(req.ticker)
    return engine.hedge_frontier(co, get_market(), req.horizon)


@app.post("/api/stress")
def stress(req: TickerHedges):
    co = _company(req.ticker)
    m = get_market()
    hedges = _h(req.hedges)
    out = []
    for s in SCENARIOS:
        imp = engine.scenario_impact(co, s["moves"], hedges, m, req.horizon)
        val = engine.valuation(co, imp["d_op_hedged"], s.get("rate_bps", 0))
        out.append({**s, "impact": imp, "valuation": val})
    return out


@app.post("/api/surface")
def surface(req: TickerHedges):
    co = _company(req.ticker)
    return engine.macro_surface(co, _h(req.hedges), get_market())


@app.post("/api/compare")
def compare(req: CompareRequest):
    cos = [_company(t) for t in req.tickers] if req.tickers else list(COMPANIES.values())
    return engine.compare(cos, get_market())


# Serve the built frontend in production (single-container deploy).
_dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if _dist.exists():
    app.mount("/", StaticFiles(directory=_dist, html=True), name="frontend")
