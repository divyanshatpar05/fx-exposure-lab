import numpy as np
import pytest

from app import engine
from app.market import FOREIGN, fallback_market, nearest_psd

MARKET = fallback_market()
COS = engine.load_companies()


@pytest.fixture(params=list(COS))
def co(request):
    return COS[request.param]


def test_mixes_are_normalised(co):
    assert sum(co.revenue_mix.values()) == pytest.approx(1.0)
    assert sum(co.cost_mix.values()) == pytest.approx(1.0)


def test_no_move_no_impact(co):
    imp = engine.scenario_impact(co, {}, {}, MARKET)
    assert imp["d_op"] == pytest.approx(0.0)


def test_linear_impact_matches_net_exposure(co):
    imp = engine.scenario_impact(co, {"EUR": -10}, {}, MARKET)
    assert imp["d_op"] == pytest.approx(-0.10 * co.exposure()["EUR"]["net"])


def test_stronger_dollar_hurts_exporters():
    # Nike sources in USD and sells abroad: a stronger USD must cut op income.
    imp = engine.scenario_impact(COS["NKE"], engine.uniform_usd_moves(10), {}, MARKET)
    assert imp["d_op"] < 0


def test_monte_carlo_matches_closed_form_volatility(co):
    """For a linear book, sd(PnL) ≈ sqrt(Nᵀ Σ N) — validates the Cholesky simulation."""
    net = co.net_vec()
    analytic = np.sqrt(net @ MARKET.cov_mat @ net) / co.op_income * 100
    mc = engine.monte_carlo(co, {}, MARKET, n_paths=40_000, seed=1)
    assert mc["unhedged"]["std"] == pytest.approx(analytic, rel=0.06)


def test_full_forward_hedge_removes_fx_variance(co):
    hedges = {c: {"ratio": 1.0, "instrument": "forward"} for c in FOREIGN}
    mc = engine.monte_carlo(co, hedges, MARKET, n_paths=5_000)
    assert mc["hedged"]["std"] < 1e-9


def test_option_hedge_caps_downside_at_premium():
    co = COS["NKE"]
    hedges = {c: {"ratio": 1.0, "instrument": "option"} for c in FOREIGN}
    crash = engine.scenario_impact(co, {c: -40 for c in FOREIGN}, hedges, MARKET)
    premium = sum(engine.hedge_cost(co.exposure()[c]["net"], 1.0, "option", MARKET.vol[c], c, 1.0) for c in FOREIGN)
    assert crash["d_op_hedged"] == pytest.approx(-premium, rel=1e-6)


def test_forward_carry_sign():
    # Selling a high-yielder (BRL) forward costs carry; selling a low-yielder (JPY) earns it.
    assert engine.hedge_cost(1.0, 1.0, "forward", 0.1, "BRL", 1.0) > 0
    assert engine.hedge_cost(1.0, 1.0, "forward", 0.1, "JPY", 1.0) < 0


def test_valuation_base_is_consistent(co):
    v = engine.valuation(co)
    assert v["per_share_new"] == pytest.approx(v["per_share_base"])
    bridge_total = sum(b["value"] for b in v["bridge"][:-1])
    assert bridge_total == pytest.approx(v["bridge"][-1]["value"])


def test_higher_rates_reduce_value(co):
    assert engine.valuation(co, 0, 200)["value_change_pct"] < 0


def test_nearest_psd_returns_valid_correlation():
    bad = np.array([[1, 0.9, -0.9], [0.9, 1, 0.9], [-0.9, 0.9, 1]], dtype=float)
    fixed = nearest_psd(bad)
    assert np.all(np.linalg.eigvalsh(fixed) > 0)
    assert np.allclose(np.diag(fixed), 1)


def test_frontier_monotone_for_forwards():
    pts = engine.hedge_frontier(COS["NKE"], MARKET, n_paths=3000)["forward"]
    vars_ = [p["var95"] for p in pts]
    assert vars_[0] > vars_[-1]
