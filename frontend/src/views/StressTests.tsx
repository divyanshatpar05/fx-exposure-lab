import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ArrowRight, History } from 'lucide-react'
import type { ViewProps } from '../App'
import { api } from '../api'
import { useAsync } from '../hooks'
import { Kpi, Loading, Panel, Tip } from '../components/ui'
import { bps, pct, tone, usd } from '../format'

export default function StressTests({ company: co, hedges, setMoves, setRateBps, goTo }: ViewProps) {
  const { data, loading } = useAsync(() => api.stress(co.ticker, hedges), [co.ticker, JSON.stringify(hedges)], 50)
  const [sel, setSel] = useState<string | null>(null)
  const hasHedges = Object.values(hedges).some((h) => h.instrument !== 'none' && h.ratio > 0)

  if (!data) return <Loading label="Replaying history…" />
  const worst = [...data].sort((a, b) => a.impact.d_op_hedged_pct - b.impact.d_op_hedged_pct)[0]
  const best = [...data].sort((a, b) => b.impact.d_op_hedged_pct - a.impact.d_op_hedged_pct)[0]
  const s = data.find((x) => x.id === sel) ?? worst
  const maxAbs = Math.max(...data.map((d) => Math.abs(d.impact.d_op_pct)), 1)
  const rows = s.impact.rows.filter((r) => Math.abs(r.move) > 0 || Math.abs(r.d_op) > 1e-6)
    .map((r) => ({ ...r, contrib: hasHedges ? r.d_op_hedged : r.d_op }))
    .sort((a, b) => a.contrib - b.contrib)

  return (
    <>
      <div className="grid g-3">
        <Kpi label="Worst historical episode" variant="warn" value={pct(worst.impact.d_op_hedged_pct)} valueClass="neg" sub={`${worst.name} · ${worst.period}`} />
        <Kpi label="Best historical episode" variant="accent" value={pct(best.impact.d_op_hedged_pct)} valueClass={tone(best.impact.d_op_hedged_pct)} sub={`${best.name} · ${best.period}`} />
        <Kpi label="Scenarios replayed" value={String(data.length)} sub={hasHedges ? 'with your current hedges applied' : 'unhedged — add hedges to compare'} />
      </div>

      <Panel title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><History size={15} color="#5eead4" />Historical FX shocks replayed on today's {co.name}</span>}
        subtitle="Each scenario applies the approximate peak-to-trough currency moves of a real episode (plus the rate move of the period) to the company's current exposure."
        className={loading ? 'busy' : ''}>
        <div className="scenario-grid">
          {data.map((d) => {
            const v = d.impact.d_op_hedged_pct
            const w = (Math.abs(d.impact.d_op_pct) / maxAbs) * 50
            const wh = (Math.abs(v) / maxAbs) * 50
            return (
              <button key={d.id} className={`scenario ${d.id === s.id ? 'active' : ''}`} onClick={() => setSel(d.id)}>
                <div>
                  <div className="t">{d.name}</div>
                  <div className="p">{d.period} · rates {bps(d.rate_bps)}</div>
                </div>
                <div className="imp">
                  <span className="muted" style={{ fontSize: 12 }}>Op. income</span>
                  <span className={`big ${tone(v)}`}>{pct(v)}</span>
                </div>
                <div className="bar-track">
                  <span className="mid" />
                  {hasHedges && <span className="fill" style={{ background: 'rgba(138,154,184,.35)', width: `${w}%`, left: d.impact.d_op_pct < 0 ? `${50 - w}%` : '50%' }} />}
                  <span className="fill" style={{ background: v < 0 ? 'var(--neg)' : 'var(--pos)', width: `${wh}%`, left: v < 0 ? `${50 - wh}%` : '50%' }} />
                </div>
                {hasHedges && <div className="note">Unhedged {pct(d.impact.d_op_pct)}</div>}
              </button>
            )
          })}
        </div>
      </Panel>

      <div className="grid g-7-5">
        <Panel title={`${s.name}: what drove the result`} subtitle={s.description}
          right={<button className="btn primary" onClick={() => { setMoves(s.moves); setRateBps(s.rate_bps); goTo('scenario') }}>Open in Scenario Lab <ArrowRight size={13} /></button>}>
          <ResponsiveContainer width="100%" height={Math.max(240, rows.length * 30)}>
            <BarChart data={rows} layout="vertical" margin={{ left: 0, right: 20 }}>
              <CartesianGrid horizontal={false} />
              <XAxis type="number" tickFormatter={(v) => usd(v)} />
              <YAxis type="category" dataKey="ccy" width={44} tickLine={false} axisLine={false} />
              <ReferenceLine x={0} stroke="#2a3a5c" />
              <Tooltip cursor={{ fill: 'rgba(96,165,250,.06)' }} content={<Tip rows={(p) => [
                ['Currency move', pct(p.move as number), tone(p.move as number)],
                ['Revenue', usd(p.d_revenue as number, true)],
                ['Costs', usd(p.d_cost as number, true)],
                ['Op. income', usd(p.d_op as number, true), tone(p.d_op as number)],
                ...(hasHedges ? [['Hedge P&L', usd(p.hedge_pnl as number, true), tone(p.hedge_pnl as number)] as [string, string, string]] : []),
              ]} />} />
              <Bar dataKey="contrib" radius={[4, 4, 4, 4]}>
                {rows.map((r) => <Cell key={r.ccy} fill={r.contrib < 0 ? '#f87171' : '#34d399'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title="Scenario P&L and valuation">
          <table className="table">
            <tbody>
              <tr><td className="muted">Revenue change</td><td className={`num ${tone(s.impact.d_revenue)}`}>{usd(s.impact.d_revenue, true)} ({pct(s.impact.d_revenue_pct)})</td></tr>
              <tr><td className="muted">Cost change</td><td className={`num ${tone(-s.impact.d_cost)}`}>{usd(s.impact.d_cost, true)}</td></tr>
              <tr><td className="muted">Op. income, unhedged</td><td className={`num ${tone(s.impact.d_op)}`}>{usd(s.impact.d_op, true)} ({pct(s.impact.d_op_pct)})</td></tr>
              <tr><td className="muted">Hedge P&L</td><td className={`num ${tone(s.impact.hedge_pnl)}`}>{usd(s.impact.hedge_pnl, true)}</td></tr>
              <tr><td className="muted">Op. income, hedged</td><td className={`num ${tone(s.impact.d_op_hedged)}`}>{usd(s.impact.d_op_hedged, true)} ({pct(s.impact.d_op_hedged_pct)})</td></tr>
              <tr><td className="muted">Rate shock</td><td className="num">{bps(s.rate_bps)}</td></tr>
              <tr><td className="muted">Extra interest expense</td><td className={`num ${tone(-s.valuation.d_interest)}`}>{usd(s.valuation.d_interest, true)}</td></tr>
              <tr><td className="muted">EPS</td><td className={`num ${tone(s.valuation.eps_change_pct)}`}>${s.valuation.eps_base.toFixed(2)} → ${s.valuation.eps_new.toFixed(2)} ({pct(s.valuation.eps_change_pct)})</td></tr>
              <tr><td className="muted">Model value / share</td><td className={`num ${tone(s.valuation.value_change_pct)}`}>{pct(s.valuation.value_change_pct)}</td></tr>
            </tbody>
          </table>
          <p className="note" style={{ marginTop: 10 }}>Moves are approximate and rounded; real episodes unfolded over different windows per currency.</p>
        </Panel>
      </div>
    </>
  )
}
