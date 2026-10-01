"""Market data: spot rates, volatilities and correlations.

Live data comes from the Frankfurter API (ECB reference rates). Statistics are
estimated from ~3 years of daily log returns and cached on disk for a day. If
the network is unavailable the module falls back to a bundled, conservative
parameter set so the app always works offline.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path

import httpx
import numpy as np

CURRENCIES = ["USD", "EUR", "GBP", "JPY", "CNY", "CHF", "CAD", "AUD", "INR", "BRL", "MXN", "KRW"]
FOREIGN = CURRENCIES[1:]

CURRENCY_META = {
    "USD": {"name": "US Dollar", "flag": "🇺🇸"},
    "EUR": {"name": "Euro", "flag": "🇪🇺"},
    "GBP": {"name": "British Pound", "flag": "🇬🇧"},
    "JPY": {"name": "Japanese Yen", "flag": "🇯🇵"},
    "CNY": {"name": "Chinese Yuan", "flag": "🇨🇳"},
    "CHF": {"name": "Swiss Franc", "flag": "🇨🇭"},
    "CAD": {"name": "Canadian Dollar", "flag": "🇨🇦"},
    "AUD": {"name": "Australian Dollar", "flag": "🇦🇺"},
    "INR": {"name": "Indian Rupee", "flag": "🇮🇳"},
    "BRL": {"name": "Brazilian Real", "flag": "🇧🇷"},
    "MXN": {"name": "Mexican Peso", "flag": "🇲🇽"},
    "KRW": {"name": "South Korean Won", "flag": "🇰🇷"},
}

# Approximate policy rates (annual, decimal), used for forward points / carry.
POLICY_RATES = {
    "USD": 0.040, "EUR": 0.020, "GBP": 0.040, "JPY": 0.005, "CNY": 0.030, "CHF": 0.000,
    "CAD": 0.0275, "AUD": 0.036, "INR": 0.055, "BRL": 0.150, "MXN": 0.075, "KRW": 0.025,
}

_FALLBACK_SPOT = {
    "EUR": 0.885, "GBP": 0.756, "JPY": 158.0, "CNY": 6.70, "CHF": 0.835, "CAD": 1.42,
    "AUD": 1.44, "INR": 96.3, "BRL": 5.19, "MXN": 18.2, "KRW": 1361.0,
}
_FALLBACK_VOL = {
    "EUR": 0.075, "GBP": 0.080, "JPY": 0.105, "CNY": 0.040, "CHF": 0.080, "CAD": 0.060,
    "AUD": 0.105, "INR": 0.045, "BRL": 0.150, "MXN": 0.130, "KRW": 0.090,
}
# One-factor "dollar" model: corr_ij = beta_i * beta_j
_FALLBACK_BETA = {
    "EUR": 0.85, "GBP": 0.75, "JPY": 0.55, "CNY": 0.55, "CHF": 0.80, "CAD": 0.55,
    "AUD": 0.70, "INR": 0.45, "BRL": 0.45, "MXN": 0.45, "KRW": 0.65,
}

API = "https://api.frankfurter.dev/v1"
CACHE_FILE = Path(__file__).parent / "data" / "market_cache.json"
CACHE_TTL = 60 * 60 * 12


@dataclass
class MarketData:
    as_of: str
    source: str  # "live" | "cache" | "fallback"
    spot: dict[str, float]          # units of currency per 1 USD
    vol: dict[str, float]           # annualised vol of currency vs USD
    corr: list[list[float]]         # correlation matrix ordered as FOREIGN
    change_1y: dict[str, float]     # % change of currency value vs USD over ~1y
    history: dict[str, list[dict]] = field(default_factory=dict)  # weekly USD value index

    @property
    def vol_vec(self) -> np.ndarray:
        return np.array([self.vol[c] for c in FOREIGN])

    @property
    def corr_mat(self) -> np.ndarray:
        return np.array(self.corr)

    @property
    def cov_mat(self) -> np.ndarray:
        v = self.vol_vec
        return self.corr_mat * np.outer(v, v)

    def to_public(self) -> dict:
        return {
            "as_of": self.as_of,
            "source": self.source,
            "currencies": FOREIGN,
            "meta": CURRENCY_META,
            "spot": self.spot,
            "vol": self.vol,
            "corr": self.corr,
            "change_1y": self.change_1y,
            "policy_rates": POLICY_RATES,
            "history": self.history,
        }


def nearest_psd(mat: np.ndarray, eps: float = 1e-8) -> np.ndarray:
    """Clip negative eigenvalues and rescale to a valid correlation matrix."""
    sym = (mat + mat.T) / 2
    w, v = np.linalg.eigh(sym)
    w = np.clip(w, eps, None)
    fixed = v @ np.diag(w) @ v.T
    d = np.sqrt(np.diag(fixed))
    fixed = fixed / np.outer(d, d)
    np.fill_diagonal(fixed, 1.0)
    return fixed


def fallback_market() -> MarketData:
    beta = np.array([_FALLBACK_BETA[c] for c in FOREIGN])
    corr = np.outer(beta, beta)
    np.fill_diagonal(corr, 1.0)
    return MarketData(
        as_of=date.today().isoformat(),
        source="fallback",
        spot=dict(_FALLBACK_SPOT),
        vol=dict(_FALLBACK_VOL),
        corr=nearest_psd(corr).round(4).tolist(),
        change_1y={c: 0.0 for c in FOREIGN},
        history={},
    )


def _fetch_live(years: int = 3) -> MarketData:
    end = date.today()
    start = end - timedelta(days=365 * years)
    url = f"{API}/{start.isoformat()}..{end.isoformat()}"
    params = {"base": "USD", "symbols": ",".join(FOREIGN)}
    with httpx.Client(timeout=15, follow_redirects=True) as client:
        resp = client.get(url, params=params)
        resp.raise_for_status()
        payload = resp.json()

    days = sorted(payload["rates"].keys())
    rows = [payload["rates"][d] for d in days]
    # Keep only days where every currency printed.
    keep = [i for i, r in enumerate(rows) if all(c in r for c in FOREIGN)]
    days = [days[i] for i in keep]
    per_usd = np.array([[rows[i][c] for c in FOREIGN] for i in keep], dtype=float)
    if len(days) < 120:
        raise RuntimeError("not enough history")

    usd_value = 1.0 / per_usd                 # USD value of one unit of currency
    rets = np.diff(np.log(usd_value), axis=0)  # daily log returns, currency vs USD
    vol = rets.std(axis=0, ddof=1) * np.sqrt(252)
    corr = nearest_psd(np.corrcoef(rets.T))

    last = per_usd[-1]
    one_year_idx = max(0, len(days) - 252)
    change_1y = usd_value[-1] / usd_value[one_year_idx] - 1

    # Weekly index (=100 one year ago) for sparklines
    history: dict[str, list[dict]] = {c: [] for c in FOREIGN}
    for i in range(one_year_idx, len(days), 5):
        for j, c in enumerate(FOREIGN):
            history[c].append({"d": days[i], "v": round(float(usd_value[i, j] / usd_value[one_year_idx, j] * 100), 3)})
    for j, c in enumerate(FOREIGN):
        history[c].append({"d": days[-1], "v": round(float(usd_value[-1, j] / usd_value[one_year_idx, j] * 100), 3)})

    return MarketData(
        as_of=days[-1],
        source="live",
        spot={c: float(last[j]) for j, c in enumerate(FOREIGN)},
        vol={c: round(float(vol[j]), 5) for j, c in enumerate(FOREIGN)},
        corr=corr.round(4).tolist(),
        change_1y={c: round(float(change_1y[j]) * 100, 3) for j, c in enumerate(FOREIGN)},
        history=history,
    )


_market: MarketData | None = None
_loaded_at: float = 0.0


def get_market(force: bool = False) -> MarketData:
    """Return market data, preferring memory → fresh disk cache → live → fallback."""
    global _market, _loaded_at
    now = time.time()
    if _market and not force and now - _loaded_at < CACHE_TTL:
        return _market

    if not force and CACHE_FILE.exists() and now - CACHE_FILE.stat().st_mtime < CACHE_TTL:
        try:
            data = json.loads(CACHE_FILE.read_text())
            _market = MarketData(**{**data, "source": "cache"})
            _loaded_at = now
            return _market
        except Exception:
            pass

    try:
        _market = _fetch_live()
        CACHE_FILE.write_text(json.dumps(_market.__dict__))
    except Exception:
        if CACHE_FILE.exists():  # stale cache beats synthetic numbers
            try:
                data = json.loads(CACHE_FILE.read_text())
                _market = MarketData(**{**data, "source": "cache"})
            except Exception:
                _market = fallback_market()
        else:
            _market = fallback_market()
    _loaded_at = now
    return _market
