import { Fragment, useState } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Dices } from 'lucide-react'
import type { ViewProps } from '../App'
import { api } from '../api'
import { useAsync } from '../hooks'
import { Ccy, Kpi, Loading, Panel, Seg, Tip } from '../components/ui'
import { CCY_COLORS, pct, usd } from '../format'

function corrColor(v: number) {
  // blue (negative) → slate (0) → teal (positive)
  const a = Math.min(1, Math.abs(v))
  return v >= 0 ? `rgba(94, 234, 212, ${0.08 + a * 0.82})` : `rgba(248, 113, 113, ${0.08 + a * 0.82})`
}

export default function MonteCarlo({ company: co, market, hedges }: ViewProps) {
  const [paths, setPaths] = useState(10000)
  const [horizon, setHorizon] = useState(1)
  const [seed, setSeed] = useState(7)
  const { data, loading } = useAsync(() => api.simulate(co.ticker, hedges, paths, horizon, seed), [co.ticker, JSON.stringify(hedges), paths, horizon, seed], 50)
  const hasHedges = Object.values(hedges).some((h) => h.instrument !== 'none' && h.ratio > 0)

  if (!data) return <Loading label="Simulating correlated currency paths…" />
  const u = data.unhedged, h = data.hedged
  const hist = data.histogram.map((b) => ({ ...b, unhedged: (b.unhedged / data.n_paths) * 100, hedged: (b.hedged / data.n_paths) * 100 }))
  const contrib = (hasHedges ? data.risk_contrib_hedged : data.risk_contrib).filter((r) => Math.abs(r.share) > 0.05)
  const ccys = market.currencies
  const lo = hist[0]?.x ?? -10, hi = hist[hist.length - 1]?.x ?? 10
  const step = [2, 5, 10, 20, 25, 50].find((st) => (hi - lo) / st <= 9) ?? 50
  const ticks: number[] = []
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) ticks.push(t)

  const statRows: [string, (s: typeof u) => string, string?][] = [
    ['Expected change', (s) => pct(s.mean, 2)],
    ['Standard deviation', (s) => pct(s.std, 2, false)],
    ['VaR 95%', (s) => pct(-s.var95)],
    ['VaR 99%', (s) => pct(-s.var99)],
    ['Expected shortfall (CVaR 95%)', (s) => pct(-s.cvar95)],
    ['P(op. income falls > 5%)', (s) => `${s.p_loss_5.toFixed(1)}%`],
    ['P(op. income rises > 5%)', (s) => `${s.p_gain_5.toFixed(1)}%`],
  ]

  return (
    <>
      <div className="grid g-5">
        <Kpi label="Paths simulated" value={data.n_paths.toLocaleString()} sub={`${horizon < 1 ? `${horizon * 12} months` : `${horizon} year${horizon > 1 ? 's' : ''}`} · 11 correlated currencies`} />
        <Kpi label="VaR 95% (unhedged)" variant="warn" value={pct(-u.var95)} valueClass="neg" sub={`${usd(u.var95_usd)} of operating income`} />
        <Kpi label="CVaR 95% (unhedged)" value={pct(-u.cvar95)} valueClass="neg" sub="average loss in the worst 5%" />
        <Kpi label="VaR 95% (hedged)" variant="accent" value={pct(-h.var95)} valueClass={hasHedges ? 'pos' : ''} sub={hasHedges ? `${(100 - (h.var95 / u.var95) * 100).toFixed(0)}% risk reduction` : 'set hedges to compare'} />
        <Kpi label="Expected hedge cost" value={hasHedges ? usd(data.hedge_cost) : '—'} sub={hasHedges ? pct(data.hedge_cost / co.op_income * 100, 2, false) + ' of op. income' : 'carry + option premium'} />
      </div>

      <Panel
        title="Distribution of FX impact on operating income"
        subtitle="Each path draws correlated lognormal currency returns from a covariance matrix estimated on live market data (Cholesky decomposition)."
        right={
          <div className="btn-row" style={{ alignItems: 'center' }}>
            <Seg value={horizon} onChange={setHorizon} options={[{ value: 0.25, label: '3M' }, { value: 0.5, label: '6M' }, { value: 1, label: '1Y' }, { value: 2, label: '2Y' }]} />
            <Seg value={paths} onChange={setPaths} options={[{ value: 2000, label: '2k' }, { value: 10000, label: '10k' }, { value: 25000, label: '25k' }]} />
            <button className="btn" onClick={() => setSeed((s) => s + 1)}><Dices size={13} />Re-run</button>
          </div>
        }
        className={loading ? 'busy' : ''}
      >
        <ResponsiveContainer width="100%" height={320}>
          <AreaChart data={hist} margin={{ top: 10, right: 12, left: 0, bottom: 4 }}>
            <defs>
              <linearGradient id="gu" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#60a5fa" stopOpacity={0.55} /><stop offset="100%" stopColor="#60a5fa" stopOpacity={0.03} /></linearGradient>
              <linearGradient id="gh" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#5eead4" stopOpacity={0.6} /><stop offset="100%" stopColor="#5eead4" stopOpacity={0.03} /></linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="x" type="number" domain={['dataMin', 'dataMax']} ticks={ticks} tickFormatter={(v) => `${v > 0 ? '+' : ''}${v.toFixed(0)}%`} />
            <YAxis tickFormatter={(v) => `${v.toFixed(1)}%`} width={48} />
            <Tooltip content={<Tip title={(p) => `Op. income ${pct(p.x as number)}`} rows={(p) => [
              ['Unhedged', `${(p.unhedged as number).toFixed(2)}% of paths`],
              ...(hasHedges ? [['Hedged', `${(p.hedged as number).toFixed(2)}% of paths`] as [string, string]] : []),
            ]} />} />
            <Area type="monotone" dataKey="unhedged" stroke="#60a5fa" strokeWidth={2} fill="url(#gu)" isAnimationActive={false} />
            {hasHedges && <Area type="monotone" dataKey="hedged" stroke="#5eead4" strokeWidth={2} fill="url(#gh)" isAnimationActive={false} />}
            <ReferenceLine x={-u.var95} stroke="#f87171" strokeDasharray="4 4" label={{ value: `VaR95 ${pct(-u.var95)}`, position: 'insideTopLeft', fill: '#f87171', fontSize: 11 }} />
            {hasHedges && <ReferenceLine x={-h.var95} stroke="#5eead4" strokeDasharray="4 4" label={{ value: `Hedged ${pct(-h.var95)}`, position: 'insideTopRight', fill: '#5eead4', fontSize: 11 }} />}
            <ReferenceLine x={0} stroke="#2a3a5c" />
          </AreaChart>
        </ResponsiveContainer>
        <div className="legend" style={{ marginTop: 6 }}>
          <span><i className="swatch" style={{ background: '#60a5fa' }} />Unhedged</span>
          {hasHedges && <span><i className="swatch" style={{ background: '#5eead4' }} />With current hedges</span>}
          <span><i className="swatch" style={{ background: '#f87171' }} />5% worst-case threshold</span>
        </div>
      </Panel>

      <div className="grid g-3">
        <Panel title="Risk statistics" subtitle="% change in operating income over the horizon.">
          <table className="table">
            <thead><tr><th>Metric</th><th className="num">Unhedged</th>{hasHedges && <th className="num">Hedged</th>}</tr></thead>
            <tbody>
              {statRows.map(([k, f]) => (
                <tr key={k}><td className="muted">{k}</td><td className="num">{f(u)}</td>{hasHedges && <td className="num pos">{f(h)}</td>}</tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel title="Risk attribution" subtitle={`Share of total FX variance contributed by each currency${hasHedges ? ' (after hedges)' : ''}. Correlations mean shares can exceed 100% or go negative.`}>
          <ResponsiveContainer width="100%" height={Math.max(200, contrib.length * 28)}>
            <BarChart data={contrib} layout="vertical" margin={{ left: 0, right: 30 }}>
              <CartesianGrid horizontal={false} />
              <XAxis type="number" tickFormatter={(v) => `${v.toFixed(0)}%`} />
              <YAxis type="category" dataKey="ccy" width={44} tickLine={false} axisLine={false} />
              <Tooltip cursor={{ fill: 'rgba(96,165,250,.06)' }} content={<Tip title={(p) => <Ccy code={p.ccy as string} />} rows={(p) => [['Variance share', `${(p.share as number).toFixed(1)}%`]]} />} />
              <Bar dataKey="share" radius={[0, 4, 4, 0]}>
                {contrib.map((c) => <Cell key={c.ccy} fill={CCY_COLORS[c.ccy]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title="Currency correlations" subtitle={`Daily returns vs USD, ${market.source === 'fallback' ? 'offline factor model' : '3-year window'}. Teal = move together.`}>
          <div className="heat" style={{ gridTemplateColumns: `34px repeat(${ccys.length}, 1fr)`, fontSize: 9.5 }}>
            <span />
            {ccys.map((c) => <span key={c} className="hdr" style={{ fontSize: 9 }}>{c}</span>)}
            {ccys.map((r, i) => (
              <Fragment key={r}>
                <span className="hdr" style={{ fontSize: 9 }}>{r}</span>
                {ccys.map((c, j) => (
                  <span key={`${r}${c}`} className="cell" title={`${r} / ${c}: ${market.corr[i][j].toFixed(2)}`}
                    style={{ background: corrColor(market.corr[i][j]), padding: '6px 0', fontSize: 9, color: Math.abs(market.corr[i][j]) > 0.5 ? '#04111a' : '#cdd6e6' }}>
                    {i === j ? '' : market.corr[i][j].toFixed(1).replace('0.', '.')}
                  </span>
                ))}
              </Fragment>
            ))}
          </div>
        </Panel>
      </div>
    </>
  )
}
