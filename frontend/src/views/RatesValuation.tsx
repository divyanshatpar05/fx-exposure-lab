import { Fragment } from 'react'
import type { ViewProps } from '../App'
import { api } from '../api'
import { useAsync } from '../hooks'
import { Kpi, Loading, Panel } from '../components/ui'
import { Waterfall } from '../components/Waterfall'
import { bps, money, pct, tone, usd } from '../format'

function heatColor(v: number, max: number) {
  const a = Math.min(1, Math.abs(v) / max)
  return v >= 0 ? `rgba(52, 211, 153, ${0.12 + a * 0.85})` : `rgba(248, 113, 113, ${0.12 + a * 0.85})`
}

export default function RatesValuation({ company: co, moves, hedges, rateBps, setRateBps }: ViewProps) {
  const hk = JSON.stringify(hedges)
  const { data, loading } = useAsync(() => api.analyze(co.ticker, moves, hedges, rateBps), [co.ticker, JSON.stringify(moves), hk, rateBps], 80)
  const surface = useAsync(() => api.surface(co.ticker, hedges), [co.ticker, hk], 100)

  const v = data?.valuation
  const fxActive = Object.values(moves).some((m) => Math.abs(m) > 0.01)
  const ms = Object.values(moves)
  const avgMove = ms.length ? ms.reduce((a, b) => a + b, 0) / 11 : 0
  const usdEquiv = (1 / (1 + avgMove / 100) - 1) * 100

  const sf = surface.data
  const maxAbs = sf ? Math.max(...sf.grid.flat().map(Math.abs), 1) : 1
  const nearest = (arr: number[], x: number) => arr.reduce((b, a) => (Math.abs(a - x) < Math.abs(b - x) ? a : b), arr[0])
  const curR = sf ? nearest(sf.rate_moves, rateBps) : 0
  const curU = sf ? nearest(sf.usd_moves, usdEquiv) : 0

  return (
    <>
      <div className="grid g-5">
        <Kpi label="Rate shock" value={bps(rateBps)} sub={`${((v?.repriced_share ?? 0) * 100).toFixed(0)}% of debt reprices within a year`} />
        <Kpi label="Extra interest expense" value={v ? usd(v.d_interest, true) : '—'} valueClass={v ? tone(-v.d_interest) : ''} sub={v ? `base ${usd(v.interest_base)} / yr` : ''} />
        <Kpi label="EPS impact" value={v ? pct(v.eps_change_pct) : '—'} valueClass={v ? tone(v.eps_change_pct) : ''} sub={v ? `$${v.eps_base.toFixed(2)} → $${v.eps_new.toFixed(2)}${fxActive ? ' (incl. FX)' : ''}` : ''} />
        <Kpi label="Discount rate (WACC)" value={v ? `${(v.wacc_new * 100).toFixed(2)}%` : '—'} sub={v ? `from ${(v.wacc_base * 100).toFixed(2)}%, g = ${(co.growth * 100).toFixed(1)}%` : ''} />
        <Kpi label="Model value / share" variant={v && v.value_change_pct < 0 ? 'warn' : 'accent'} value={v ? pct(v.value_change_pct) : '—'} valueClass={v ? tone(v.value_change_pct) : ''} sub={v ? `${money(v.per_share_base)} → ${money(v.per_share_new)}` : ''} />
      </div>

      <div className="grid g-5-7">
        <Panel title="Interest-rate shock" subtitle="A parallel shift in rates hits the company three ways: floating-rate and maturing debt reprice, the discount rate rises, and any FX shock from the Scenario Lab flows through cash flow.">
          <div className="slider-row" style={{ gridTemplateColumns: '1fr 70px' }}>
            <input type="range" min={-300} max={400} step={25} value={rateBps} onChange={(e) => setRateBps(Number(e.target.value))} aria-label="Rate shock in basis points" />
            <span className={`val ${tone(-rateBps)}`}>{bps(rateBps)}</span>
          </div>
          <div className="btn-row" style={{ margin: '8px 0 16px' }}>
            {[-200, -100, 0, 100, 200, 300].map((b) => <button key={b} className="btn" onClick={() => setRateBps(b)}>{b === 0 ? 'Flat' : bps(b)}</button>)}
          </div>
          <div className="stats">
            <div className="stat"><div className="k">Total debt</div><div className="v">{usd(co.debt)}</div></div>
            <div className="stat"><div className="k">Net debt</div><div className="v">{usd(co.net_debt)}{co.net_debt < 0 && <small>net cash</small>}</div></div>
            <div className="stat"><div className="k">Floating-rate share</div><div className="v">{(co.floating_share * 100).toFixed(0)}%</div></div>
            <div className="stat"><div className="k">Maturing in 12m</div><div className="v">{(co.refi_share * 100).toFixed(0)}%</div></div>
            <div className="stat"><div className="k">Avg. cost of debt</div><div className="v">{(co.avg_rate * 100).toFixed(2)}%</div></div>
            <div className="stat"><div className="k">Free cash flow</div><div className="v">{usd(co.fcf)}</div></div>
          </div>
          {fxActive && <p className="note" style={{ marginTop: 12 }}>Including your Scenario Lab FX shock ({Object.keys(moves).length} currencies, ≈ {pct(usdEquiv)} broad USD move).</p>}
        </Panel>

        <Panel title="Value bridge (per share)" subtitle="Perpetuity-growth DCF: base value → FX effect on free cash flow → higher interest expense → higher discount rate." className={loading ? 'busy' : ''}>
          {v ? <Waterfall steps={v.bridge.map((b, i) => ({ name: b.step, value: b.value, total: i === 0 || i === v.bridge.length - 1 }))} fmt={(x) => money(x, Math.abs(x) >= 1000 ? 0 : 2)} height={300} /> : <Loading />}
          <p className="note">Absolute values come from a deliberately simple model — read the % changes, not the price target.</p>
        </Panel>
      </div>

      <Panel
        title="Macro shock surface"
        subtitle="Model equity value change (%) for every combination of a broad USD move and a parallel rate shock, with current hedges applied. The outlined cell is closest to your current settings."
      >
        {!sf ? <Loading /> : (
          <div className="table-wrap">
            <div className="heat" style={{ gridTemplateColumns: `86px repeat(${sf.usd_moves.length}, minmax(58px, 1fr))`, minWidth: 640 }}>
              <span className="hdr">Rates ↓ / USD →</span>
              {sf.usd_moves.map((u) => <span key={u} className="hdr">{u > 0 ? '+' : ''}{u}%</span>)}
              {sf.rate_moves.map((r, i) => (
                <Fragment key={r}>
                  <span className="hdr">{bps(r)}</span>
                  {sf.grid[i].map((val, j) => (
                    <span key={j} className={`cell ${r === curR && sf.usd_moves[j] === curU ? 'cur' : ''}`}
                      style={{ background: heatColor(val, maxAbs), color: Math.abs(val) / maxAbs > 0.45 ? '#04111a' : '#e6ecf7' }}
                      title={`USD ${sf.usd_moves[j] > 0 ? '+' : ''}${sf.usd_moves[j]}%, rates ${bps(r)} → ${pct(val)}`}>
                      {pct(val, 0)}
                    </span>
                  ))}
                </Fragment>
              ))}
            </div>
          </div>
        )}
      </Panel>
    </>
  )
}
