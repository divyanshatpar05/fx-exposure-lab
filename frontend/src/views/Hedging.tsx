import { CartesianGrid, Legend, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts'
import type { ViewProps } from '../App'
import { api } from '../api'
import { useAsync } from '../hooks'
import { Ccy, Kpi, Loading, Panel, Seg, Tip } from '../components/ui'
import { pct, tone, usd } from '../format'
import type { Hedges, Instrument } from '../types'

const MAJORS = ['EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD']

export default function Hedging({ company: co, market, hedges, setHedges }: ViewProps) {
  const key = JSON.stringify(hedges)
  const analysis = useAsync(() => api.analyze(co.ticker, {}, hedges, 0), [co.ticker, key], 100)
  const sim = useAsync(() => api.simulate(co.ticker, hedges, 8000, 1, 7), [co.ticker, key], 200)
  const frontier = useAsync(() => api.frontier(co.ticker), [co.ticker], 0)

  const ccys = market.currencies.filter((c) => Math.abs(co.exposure[c].net) > 1e-6)
  const policy = (ratio: number, inst: Instrument, only?: string[]) =>
    setHedges(Object.fromEntries(ccys.filter((c) => !only || only.includes(c)).map((c) => [c, { ratio, instrument: inst }])) as Hedges)
  const update = (c: string, patch: Partial<{ ratio: number; instrument: Instrument }>) => {
    const cur = hedges[c] ?? { ratio: 0, instrument: 'none' as Instrument }
    const next = { ...cur, ...patch }
    if (patch.instrument && patch.instrument !== 'none' && next.ratio === 0) next.ratio = 0.5
    setHedges({ ...hedges, [c]: next })
  }

  const s = sim.data
  const costRows = Object.fromEntries((analysis.data?.hedges ?? []).map((r) => [r.ccy, r]))
  const totalCost = analysis.data?.total_hedge_cost ?? 0
  const hedgedNotional = ccys.reduce((acc, c) => {
    const h = hedges[c]
    return acc + (h && h.instrument !== 'none' ? Math.abs(co.exposure[c].net) * h.ratio : 0)
  }, 0)
  const grossNet = ccys.reduce((a, c) => a + Math.abs(co.exposure[c].net), 0)

  const fwd = (frontier.data?.forward ?? []).map((p) => ({ ...p, x: p.cost_pct, y: p.var95 }))
  const opt = (frontier.data?.option ?? []).map((p) => ({ ...p, x: p.cost_pct, y: p.var95 }))
  const current = s ? [{ x: (totalCost / co.op_income) * 100, y: s.hedged.var95, ratio: -1 }] : []

  return (
    <>
      <div className="grid g-5">
        <Kpi label="Hedged notional" value={usd(hedgedNotional)} sub={`${grossNet ? ((hedgedNotional / grossNet) * 100).toFixed(0) : 0}% of net exposure`} />
        <Kpi label="VaR 95% before" variant="warn" value={s ? pct(-s.unhedged.var95) : '—'} valueClass="neg" sub="1-year, op. income" />
        <Kpi label="VaR 95% after" variant="accent" value={s ? pct(-s.hedged.var95) : '—'} valueClass="pos" sub={s && s.unhedged.var95 ? `${(100 - (s.hedged.var95 / s.unhedged.var95) * 100).toFixed(0)}% reduction` : ''} />
        <Kpi label="Annual hedge cost" value={usd(totalCost)} valueClass={tone(-totalCost)} sub={totalCost < 0 ? 'positive carry — you earn it' : 'forward points + premiums'} />
        <Kpi label="Risk cut per $1 cost"
          value={!s || hedgedNotional === 0 ? '—' : totalCost > 0.0001 ? `$${((s.unhedged.var95_usd - s.hedged.var95_usd) / totalCost).toFixed(1)}` : 'Free'}
          valueClass={s && hedgedNotional > 0 && totalCost <= 0.0001 ? 'pos' : ''}
          sub={totalCost <= 0.0001 && hedgedNotional > 0 ? 'carry pays for the protection' : 'VaR reduction ÷ cost'} />
      </div>

      <Panel
        title="Hedge program"
        subtitle="Choose an instrument and hedge ratio per currency. Forwards lock the rate (and carry the interest differential); ATM options cap the downside for an up-front premium and keep the upside."
        right={
          <div className="btn-row">
            <button className="btn" onClick={() => setHedges({})}>None</button>
            <button className="btn" onClick={() => policy(0.5, 'forward')}>50% forwards</button>
            <button className="btn" onClick={() => policy(0.75, 'forward', MAJORS)}>75% majors</button>
            <button className="btn" onClick={() => policy(1, 'option')}>100% options</button>
            <button className="btn primary" onClick={() => {
              // Layered: forwards on low-carry majors, options on volatile / high-carry EM.
              const h: Hedges = {}
              for (const c of ccys) h[c] = MAJORS.includes(c) || c === 'CNY' ? { ratio: 0.7, instrument: 'forward' } : { ratio: 0.5, instrument: 'option' }
              setHedges(h)
            }}>Smart layered</button>
          </div>
        }
      >
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Currency</th><th className="num">Net exposure</th><th className="num">Vol</th><th className="num" title="Policy rate minus USD rate">Carry diff.</th>
                <th>Instrument</th><th style={{ width: 240 }}>Hedge ratio</th><th className="num">Annual cost</th>
              </tr>
            </thead>
            <tbody>
              {ccys.map((c) => {
                const h = hedges[c] ?? { ratio: 0, instrument: 'none' as Instrument }
                const carry = (market.policy_rates[c] - market.policy_rates.USD) * 100
                const cost = costRows[c]?.cost ?? 0
                const active = h.instrument !== 'none' && h.ratio > 0
                return (
                  <tr key={c} className={active ? 'hl' : ''}>
                    <td><Ccy code={c} /></td>
                    <td className={`num ${co.exposure[c].net < 0 ? 'neg' : ''}`}>{usd(co.exposure[c].net)}</td>
                    <td className="num">{(market.vol[c] * 100).toFixed(1)}%</td>
                    <td className={`num ${tone(-carry)}`}>{carry > 0 ? '+' : ''}{carry.toFixed(2)}%</td>
                    <td>
                      <Seg value={h.instrument} onChange={(v) => update(c, { instrument: v })} options={[
                        { value: 'none', label: 'None' }, { value: 'forward', label: 'Forward' }, { value: 'option', label: 'Option' },
                      ]} />
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, opacity: h.instrument === 'none' ? 0.35 : 1 }}>
                        <input type="range" min={0} max={1} step={0.05} value={h.ratio} disabled={h.instrument === 'none'}
                          onChange={(e) => update(c, { ratio: Number(e.target.value) })} aria-label={`${c} hedge ratio`} />
                        <span className="mono" style={{ width: 40, textAlign: 'right', fontSize: 12.5 }}>{(h.ratio * 100).toFixed(0)}%</span>
                      </div>
                    </td>
                    <td className={`num ${tone(-cost)}`}>{active ? usd(cost) : <span className="dim">—</span>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="note" style={{ marginTop: 10 }}>
          Forward cost ≈ hedge notional × (foreign rate − USD rate). Selling a high-yielder like BRL forward is expensive; selling JPY or CHF forward actually <em>earns</em> carry.
          Option premium ≈ 0.4 × σ × √T × notional (Brenner–Subrahmanyam ATM approximation).
        </p>
      </Panel>

      <Panel
        title="Hedging efficiency frontier"
        subtitle="Sweeping a uniform hedge ratio from 0% to 100% on every currency. Down-and-left is better: less tail risk for less cost. Your current program is the gold dot."
      >
        {!frontier.data ? <Loading label="Tracing the frontier…" /> : (
          <ResponsiveContainer width="100%" height={340}>
            <ScatterChart margin={{ top: 10, right: 20, left: 0, bottom: 20 }}>
              <CartesianGrid />
              <XAxis type="number" dataKey="x" name="Cost" tickFormatter={(v) => `${v.toFixed(1)}%`} label={{ value: 'Expected hedge cost (% of op. income)', position: 'insideBottom', offset: -12 }} />
              <YAxis type="number" dataKey="y" name="VaR" tickFormatter={(v) => `${v.toFixed(0)}%`} width={48} label={{ value: 'VaR 95%', angle: -90, position: 'insideLeft', offset: 12 }} />
              <ZAxis range={[50, 50]} />
              <Tooltip content={<Tip title={(p) => (p.ratio as number) < 0 ? 'Your program' : `${p.ratio}% hedged`} rows={(p) => [
                ['VaR 95%', pct(-(p.y as number))],
                ['Cost', `${(p.x as number).toFixed(2)}% of op. inc.`],
              ]} />} />
              <Legend verticalAlign="top" height={30} wrapperStyle={{ fontSize: 12 }} />
              <Scatter name="Forwards" data={fwd} fill="#60a5fa" line={{ stroke: '#60a5fa', strokeWidth: 2 }} />
              <Scatter name="ATM options" data={opt} fill="#a78bfa" line={{ stroke: '#a78bfa', strokeWidth: 2 }} />
              <Scatter name="Current program" data={current} fill="#fbbf24" shape="star" />
            </ScatterChart>
          </ResponsiveContainer>
        )}
      </Panel>
    </>
  )
}
