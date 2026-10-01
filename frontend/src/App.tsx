import { useEffect, useMemo, useState } from 'react'
import {
  Activity, BarChart3, Building2, Flame, Gauge, Landmark, LayoutDashboard, Shield, SlidersHorizontal, X,
} from 'lucide-react'
import { api } from './api'
import type { CompanyDetail, CompanySummary, Hedges, Market, Moves } from './types'
import { Tape } from './components/Tape'
import { Loading } from './components/ui'
import { pct, bps } from './format'
import Overview from './views/Overview'
import ScenarioLab from './views/ScenarioLab'
import MonteCarlo from './views/MonteCarlo'
import Hedging from './views/Hedging'
import StressTests from './views/StressTests'
import RatesValuation from './views/RatesValuation'
import Compare from './views/Compare'

const TABS = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'scenario', label: 'Scenario Lab', icon: SlidersHorizontal },
  { id: 'montecarlo', label: 'Monte Carlo', icon: Activity },
  { id: 'hedging', label: 'Hedging', icon: Shield },
  { id: 'stress', label: 'Stress Tests', icon: Flame },
  { id: 'rates', label: 'Rates & Valuation', icon: Landmark },
  { id: 'compare', label: 'Compare', icon: BarChart3 },
] as const
type TabId = (typeof TABS)[number]['id']

export interface ViewProps {
  market: Market
  company: CompanyDetail
  moves: Moves
  setMoves: (m: Moves) => void
  hedges: Hedges
  setHedges: (h: Hedges) => void
  rateBps: number
  setRateBps: (r: number) => void
  goTo: (tab: TabId) => void
  selectTicker: (t: string) => void
}

function readHash(): { ticker?: string; tab?: TabId } {
  const [t, tab] = window.location.hash.replace('#', '').split('/')
  return { ticker: t?.toUpperCase() || undefined, tab: TABS.some((x) => x.id === tab) ? (tab as TabId) : undefined }
}

export default function App() {
  const initial = readHash()
  const [market, setMarket] = useState<Market | null>(null)
  const [companies, setCompanies] = useState<CompanySummary[]>([])
  const [ticker, setTicker] = useState(initial.ticker ?? 'NKE')
  const [company, setCompany] = useState<CompanyDetail | null>(null)
  const [tab, setTab] = useState<TabId>(initial.tab ?? 'overview')
  const [moves, setMoves] = useState<Moves>({})
  const [hedges, setHedges] = useState<Hedges>({})
  const [rateBps, setRateBps] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([api.market(), api.companies()])
      .then(([m, c]) => { setMarket(m); setCompanies(c) })
      .catch((e) => setError(`Could not reach the API — is the backend running on :8000? (${e.message})`))
  }, [])

  useEffect(() => {
    let alive = true
    api.company(ticker).then((c) => alive && setCompany(c)).catch((e) => setError(e.message))
    return () => { alive = false }
  }, [ticker])

  useEffect(() => { window.history.replaceState(null, '', `#${ticker}/${tab}`) }, [ticker, tab])

  const selectTicker = (t: string) => {
    setTicker(t)
    setHedges({})
  }

  const activeMoves = useMemo(() => Object.values(moves).filter((v) => Math.abs(v) > 0.01).length, [moves])
  const activeHedges = useMemo(() => Object.values(hedges).filter((h) => h.instrument !== 'none' && h.ratio > 0).length, [hedges])

  if (error) return <div style={{ padding: 40 }}><div className="error">{error}</div></div>
  if (!market) return <Loading label="Loading live FX market data…" />

  const props: ViewProps | null = company && company.ticker === ticker ? {
    market, company, moves, setMoves, hedges, setHedges, rateBps, setRateBps, goTo: setTab, selectTicker,
  } : null

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <svg width="20" height="20" viewBox="0 0 32 32"><path d="M5 22 L12 14 L17 18 L27 7" stroke="#5eead4" strokeWidth="3.2" fill="none" strokeLinecap="round" strokeLinejoin="round" /><circle cx="27" cy="7" r="2.8" fill="#fbbf24" /></svg>
          </div>
          <div>
            <h1>FX Exposure Lab</h1>
            <p>Currency risk for multinationals</p>
          </div>
        </div>
        <div className="side-label"><Building2 size={11} style={{ verticalAlign: -1, marginRight: 6 }} />Companies · foreign rev.</div>
        <div className="company-list">
          {companies.map((c) => (
            <button key={c.ticker} className={`company-item ${c.ticker === ticker ? 'active' : ''}`} onClick={() => selectTicker(c.ticker)}>
              <span className="tk">{c.ticker}</span>
              <span style={{ minWidth: 0 }}>
                <div className="nm">{c.name}</div>
                <div className="sc">{c.sector}</div>
              </span>
              <span title={`${(c.foreign_revenue_share * 100).toFixed(0)}% of revenue outside the US`} style={{ display: 'grid', justifyItems: 'end', gap: 3 }}>
                <span className="mono dim" style={{ fontSize: 10.5 }}>{(c.foreign_revenue_share * 100).toFixed(0)}%</span>
                <span className="fr-bar"><span style={{ width: `${c.foreign_revenue_share * 100}%` }} /></span>
              </span>
            </button>
          ))}
        </div>
        <div className="side-foot">
          <span className={`source-pill ${market.source === 'fallback' ? 'fallback' : ''}`}>
            <span className="dot" />
            {market.source === 'fallback' ? 'Offline parameters' : 'Live ECB rates'} · {market.as_of}
          </span>
          <p style={{ margin: '10px 0 0' }}>
            Vols & correlations estimated from 3 years of daily returns. Company profiles are illustrative approximations of 10-K disclosures.
          </p>
        </div>
      </aside>

      <main className="main">
        <Tape market={market} />
        <header className="header">
          <div className="header-row">
            <div style={{ minWidth: 0 }}>
              {company && (
                <>
                  <div className="co-title">
                    <h2>{company.name}</h2>
                    <span className="tk">{company.ticker}</span>
                    <span className="sector">{company.sector}</span>
                  </div>
                  <p className="co-blurb">{company.blurb}</p>
                </>
              )}
              <div className="mobile-picker">
                <select className="sel" value={ticker} onChange={(e) => selectTicker(e.target.value)}>
                  {companies.map((c) => <option key={c.ticker} value={c.ticker}>{c.ticker} — {c.name}</option>)}
                </select>
              </div>
            </div>
            <div className="header-chips">
              <span className={`chip ${activeMoves ? 'on' : ''}`}>
                <SlidersHorizontal size={12} />{activeMoves ? `${activeMoves} FX shocks` : 'No FX shock'}
                {activeMoves > 0 && <button aria-label="Clear shocks" onClick={() => setMoves({})}><X size={12} /></button>}
              </span>
              <span className={`chip ${activeHedges ? 'on' : ''}`}>
                <Shield size={12} />{activeHedges ? `${activeHedges} hedges` : 'Unhedged'}
                {activeHedges > 0 && <button aria-label="Clear hedges" onClick={() => setHedges({})}><X size={12} /></button>}
              </span>
              <span className={`chip ${rateBps ? 'on' : ''}`}>
                <Gauge size={12} />{rateBps ? `Rates ${bps(rateBps)}` : 'Rates flat'}
                {rateBps !== 0 && <button aria-label="Clear rate shock" onClick={() => setRateBps(0)}><X size={12} /></button>}
              </span>
              {company && <span className="chip" title="1-year 95% FX Value-at-Risk on operating income, unhedged">VaR₉₅ {pct(-company.var95)}</span>}
            </div>
          </div>
          <nav className="tabs">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button key={id} className={`tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
                <Icon size={15} />{label}
              </button>
            ))}
          </nav>
        </header>

        <div className="content">
          <div className="content-inner" key={`${ticker}-${tab}`}>
            {!props ? <Loading /> : (
              <>
                {tab === 'overview' && <Overview {...props} />}
                {tab === 'scenario' && <ScenarioLab {...props} />}
                {tab === 'montecarlo' && <MonteCarlo {...props} />}
                {tab === 'hedging' && <Hedging {...props} />}
                {tab === 'stress' && <StressTests {...props} />}
                {tab === 'rates' && <RatesValuation {...props} />}
                {tab === 'compare' && <Compare {...props} />}
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
