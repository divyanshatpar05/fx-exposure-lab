import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { RotateCcw, Shield } from 'lucide-react'
import type { ViewProps } from '../App'
import { api } from '../api'
import { useAsync } from '../hooks'
import { Ccy, Kpi, Loading, Panel, Seg, Tip } from '../components/ui'
import { Waterfall } from '../components/Waterfall'
import { pct, tone, usd } from '../format'
import type { Moves } from '../types'

const usdMove = (u: number) => (1 / (1 + u / 100) - 1) * 100

const PRESETS: { label: string; build: (ccys: string[]) => Moves }[] = [
  { label: 'USD +10%', build: (c) => Object.fromEntries(c.map((x) => [x, usdMove(10)])) },
  { label: 'USD −10%', build: (c) => Object.fromEntries(c.map((x) => [x, usdMove(-10)])) },
  { label: 'EM crash', build: () => ({ BRL: -25, MXN: -20, INR: -12, KRW: -15, CNY: -8 }) },
  { label: 'Euro crisis', build: () => ({ EUR: -15, GBP: -8, CHF: 6 }) },
  { label: 'Yen surge', build: () => ({ JPY: 15, KRW: 4, CNY: 2 }) },
]

export default function ScenarioLab({ company: co, market, moves, setMoves, hedges, rateBps, goTo }: ViewProps) {
  const [view, setView] = useState<'unhedged' | 'hedged'>('unhedged')
  const [broad, setBroad] = useState(0)
  const { data, loading } = useAsync(() => api.analyze(co.ticker, moves, hedges, rateBps), [co.ticker, JSON.stringify(moves), JSON.stringify(hedges), rateBps], 120)
  const ccys = market.currencies.filter((c) => co.exposure[c].revenue > 0 || co.exposure[c].cost > 0)
  const hasHedges = Object.values(hedges).some((h) => h.instrument !== 'none' && h.ratio > 0)
  const set = (c: string, v: number) => setMoves({ ...moves, [c]: v })

  const imp = data?.impact
  const steps = imp ? [
    { name: 'Base', value: co.op_income, total: true },
    ...imp.rows.filter((r) => Math.abs(r.d_op) > 0.0005).sort((a, b) => a.d_op - b.d_op).slice(0, 7).map((r) => ({ name: r.ccy, value: r.d_op })),
    ...(() => {
      const shown = imp.rows.filter((r) => Math.abs(r.d_op) > 0.0005).sort((a, b) => a.d_op - b.d_op).slice(0, 7)
      const rest = imp.d_op - shown.reduce((s, r) => s + r.d_op, 0)
      return Math.abs(rest) > 0.0005 ? [{ name: 'Other', value: rest }] : []
    })(),
    ...(Math.abs(imp.hedge_pnl) > 0.0005 ? [{ name: 'Hedges', value: imp.hedge_pnl }] : []),
    { name: 'Shocked', value: imp.op_after, total: true },
  ] : []

  const torn = (data?.tornado ?? []).filter((t) => Math.abs(t.up) + Math.abs(t.down) > 1e-6).slice(0, 9).map((t) => ({
    ccy: t.ccy,
    down: view === 'hedged' ? t.down_hedged : t.down,
    up: view === 'hedged' ? t.up_hedged : t.up,
  }))

  return (
    <>
      <div className="grid g-5">
        <Kpi label="Revenue impact" value={imp ? pct(imp.d_revenue_pct) : '—'} valueClass={imp ? tone(imp.d_revenue) : ''} sub={imp ? usd(imp.d_revenue, true) : ''} />
        <Kpi label="Cost impact" value={imp ? usd(imp.d_cost, true) : '—'} valueClass={imp ? tone(-imp.d_cost) : ''} sub={imp ? (imp.d_cost < 0 ? 'cheaper foreign costs help' : imp.d_cost > 0 ? 'pricier foreign costs hurt' : 'no change') : ''} />
        <Kpi label="Op. income (unhedged)" value={imp ? pct(imp.d_op_pct) : '—'} valueClass={imp ? tone(imp.d_op) : ''} sub={imp ? usd(imp.d_op, true) : ''} />
        <Kpi label="Op. income (hedged)" variant="accent" value={imp ? pct(imp.d_op_hedged_pct) : '—'} valueClass={imp ? tone(imp.d_op_hedged) : ''} sub={hasHedges ? `hedge P&L ${usd(imp?.hedge_pnl ?? 0, true)}` : 'no hedges set'} />
        <Kpi label="EPS impact" value={data ? pct(data.valuation.eps_change_pct) : '—'} valueClass={data ? tone(data.valuation.eps_change_pct) : ''} sub={data ? `$${data.valuation.eps_base.toFixed(2)} → $${data.valuation.eps_new.toFixed(2)}` : ''} />
      </div>

      <div className="grid g-5-7">
        <Panel
          title="Currency shocks"
          subtitle="Move each currency against the dollar. Negative = foreign currency weakens (stronger USD)."
          right={<button className="btn ghost" onClick={() => { setBroad(0); setMoves({}) }}><RotateCcw size={13} />Reset</button>}
        >
          <div className="btn-row" style={{ marginBottom: 14 }}>
            {PRESETS.map((p) => <button key={p.label} className="btn" onClick={() => { setBroad(0); setMoves(p.build(market.currencies)) }}>{p.label}</button>)}
          </div>
          <div className="slider-row" style={{ borderBottom: '1px solid var(--line)', paddingBottom: 12, marginBottom: 6 }}>
            <span style={{ fontWeight: 600, fontSize: 12.5 }} title="Positive = stronger dollar against every currency">Broad USD</span>
            <input type="range" min={-25} max={25} step={1} value={broad} aria-label="Broad USD move"
              onChange={(e) => { const u = Number(e.target.value); setBroad(u); setMoves(Object.fromEntries(market.currencies.map((c) => [c, usdMove(u)]))) }}
            />
            <span className={`val ${tone(-broad)}`}>{broad ? pct(broad, 0) : '—'}</span>
          </div>
          {ccys.map((c) => {
            const v = moves[c] ?? 0
            return (
              <div className="slider-row" key={c}>
                <span title={market.meta[c].name}><Ccy code={c} /></span>
                <input type="range" min={-30} max={30} step={0.5} value={v} onChange={(e) => set(c, Number(e.target.value))} aria-label={`${c} move`} />
                <span className={`val ${tone(v)}`}>{pct(v)}</span>
              </div>
            )
          })}
        </Panel>

        <div className="grid" style={{ alignContent: 'start' }}>
          <Panel title="Operating income bridge" subtitle="From base operating income to the shocked result, currency by currency." className={loading ? 'busy' : ''}>
            {imp ? <Waterfall steps={steps} fmt={(v) => usd(v)} height={290} /> : <Loading />}
            {imp && !hasHedges && (
              <p className="note" style={{ marginTop: 8 }}>
                Tip: add forwards or options on the <a href="#" onClick={(e) => { e.preventDefault(); goTo('hedging') }} style={{ color: 'var(--accent)' }}><Shield size={11} style={{ verticalAlign: -1 }} /> Hedging</a> tab and they'll flow through here.
              </p>
            )}
          </Panel>

          <Panel
            title="Sensitivity tornado"
            subtitle="Operating income change for a ±10% move in each currency on its own."
            right={hasHedges ? <Seg value={view} onChange={setView} options={[{ value: 'unhedged', label: 'Unhedged' }, { value: 'hedged', label: 'Hedged' }]} /> : undefined}
          >
            <ResponsiveContainer width="100%" height={Math.max(200, torn.length * 30)}>
              <BarChart data={torn} layout="vertical" stackOffset="sign" margin={{ left: 0, right: 16 }} barCategoryGap="25%">
                <CartesianGrid horizontal={false} />
                <XAxis type="number" tickFormatter={(v) => usd(v)} />
                <YAxis type="category" dataKey="ccy" width={44} tickLine={false} axisLine={false} />
                <ReferenceLine x={0} stroke="#2a3a5c" />
                <Tooltip cursor={{ fill: 'rgba(96,165,250,.06)' }} content={<Tip rows={(p) => [
                  [`${p.ccy} −10%`, usd(p.down as number, true), tone(p.down as number)],
                  [`${p.ccy} +10%`, usd(p.up as number, true), tone(p.up as number)],
                ]} />} />
                <Bar dataKey="down" stackId="t" radius={[4, 4, 4, 4]}>
                  {torn.map((t) => <Cell key={t.ccy} fill={t.down < 0 ? '#f87171' : '#34d399'} />)}
                </Bar>
                <Bar dataKey="up" stackId="t" radius={[4, 4, 4, 4]}>
                  {torn.map((t) => <Cell key={t.ccy} fill={t.up < 0 ? '#f87171' : '#34d399'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Panel>
        </div>
      </div>
    </>
  )
}
