import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine } from 'recharts'
import { Globe2, Percent, Sparkles, TrendingDown, Wallet, AlertTriangle } from 'lucide-react'
import type { ViewProps } from '../App'
import { Ccy, Kpi, Panel, Tip } from '../components/ui'
import { CCY_COLORS, pct, usd } from '../format'

export default function Overview({ company: co, market }: ViewProps) {
  const rows = market.currencies
    .map((c) => {
      const e = co.exposure[c]
      return {
        ccy: c, ...e,
        natural: e.revenue > 0 ? Math.min(e.revenue, e.cost) / e.revenue * 100 : 0,
        vol: market.vol[c],
        oneSigma: Math.abs(e.net) * market.vol[c],
      }
    })
    .filter((r) => r.revenue > 0 || r.cost > 0)
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net))

  const grossNet = rows.reduce((s, r) => s + Math.abs(r.net), 0)
  const mix = Object.entries(co.revenue_mix).sort((a, b) => b[1] - a[1]).map(([ccy, w]) => ({ ccy, w: w * 100 }))
  const costMix = Object.entries(co.cost_mix).sort((a, b) => b[1] - a[1]).map(([ccy, w]) => ({ ccy, w: w * 100 }))

  return (
    <>
      <div className="grid g-5">
        <Kpi icon={<Wallet size={13} />} label="Revenue" value={usd(co.revenue)} sub={`Op. income ${usd(co.op_income)} · ${(co.op_margin * 100).toFixed(0)}% margin`} />
        <Kpi icon={<Globe2 size={13} />} label="Foreign revenue" value={pct(co.foreign_revenue_share * 100, 0, false)} sub={`${pct((1 - (co.cost_mix.USD ?? 0)) * 100, 0, false)} of costs abroad`} />
        <Kpi icon={<Percent size={13} />} label="Net FX exposure" value={usd(grossNet)} sub={`${(grossNet / co.op_income * 100).toFixed(0)}% of operating income`} />
        <Kpi icon={<TrendingDown size={13} />} variant="warn" label="If USD +10%" value={pct(co.usd10.d_op_pct)} valueClass="neg" sub={`${usd(co.usd10.d_op, true)} operating income`} />
        <Kpi icon={<AlertTriangle size={13} />} variant="accent" label="1-yr FX VaR (95%)" value={pct(-co.var95)} sub="of operating income, unhedged" />
      </div>

      <div className="grid g-7-5">
        <Panel
          title="Where the currency risk sits"
          subtitle="Foreign revenue vs. foreign costs by currency (USD bn). Net exposure is what's left unmatched — the part FX can actually hurt."
          right={<div className="legend"><span><i className="swatch" style={{ background: '#60a5fa' }} />Revenue</span><span><i className="swatch" style={{ background: '#475569' }} />Costs</span><span><i className="swatch" style={{ background: '#5eead4' }} />Net</span></div>}
        >
          <ResponsiveContainer width="100%" height={Math.max(260, rows.length * 34)}>
            <BarChart data={rows} layout="vertical" margin={{ left: 0, right: 16 }} barGap={2} barCategoryGap="22%">
              <CartesianGrid horizontal={false} />
              <XAxis type="number" tickFormatter={(v) => `$${v}`} />
              <YAxis type="category" dataKey="ccy" width={44} tickLine={false} axisLine={false} />
              <ReferenceLine x={0} stroke="#2a3a5c" />
              <Tooltip cursor={{ fill: 'rgba(96,165,250,.06)' }} content={<Tip rows={(p) => [
                ['Revenue', usd(p.revenue as number)],
                ['Costs', usd(p.cost as number)],
                ['Net exposure', usd(p.net as number), 'pos'],
                ['Naturally hedged', `${(p.natural as number).toFixed(0)}%`],
              ]} />} />
              <Bar dataKey="revenue" fill="#60a5fa" radius={[0, 4, 4, 0]} />
              <Bar dataKey="cost" fill="#475569" radius={[0, 4, 4, 0]} />
              <Bar dataKey="net" fill="#5eead4" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title="Revenue vs. cost currency mix" subtitle="Outer ring: revenue. Inner ring: costs. The gap between them is the exposure.">
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie data={costMix} dataKey="w" nameKey="ccy" innerRadius={52} outerRadius={72} paddingAngle={1.5} stroke="none">
                {costMix.map((d) => <Cell key={d.ccy} fill={CCY_COLORS[d.ccy]} fillOpacity={0.55} />)}
              </Pie>
              <Pie data={mix} dataKey="w" nameKey="ccy" innerRadius={80} outerRadius={108} paddingAngle={1.5} stroke="none">
                {mix.map((d) => <Cell key={d.ccy} fill={CCY_COLORS[d.ccy]} />)}
              </Pie>
              <Tooltip content={<Tip title={(p) => <Ccy code={p.ccy as string} />} rows={(p) => [['Share', `${(p.w as number).toFixed(1)}%`]]} />} />
            </PieChart>
          </ResponsiveContainer>
          <div className="legend" style={{ justifyContent: 'center' }}>
            {mix.slice(0, 8).map((m) => (
              <span key={m.ccy}><i className="swatch" style={{ background: CCY_COLORS[m.ccy] }} />{m.ccy} <span className="mono dim">{m.w.toFixed(0)}%</span></span>
            ))}
          </div>
        </Panel>
      </div>

      <div className="grid g-5-7">
        <Panel title={<span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}><Sparkles size={15} color="#5eead4" />What the model says</span>}>
          {co.narrative.map((line, i) => (
            <div className="insight" key={i}><span className="n">{i + 1}</span><span>{line}</span></div>
          ))}
        </Panel>

        <Panel title="Exposure detail" subtitle="1σ impact = net exposure × annual volatility estimated from live market data.">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Currency</th><th className="num">Revenue</th><th className="num">Costs</th><th className="num">Net</th>
                  <th className="num">Nat. hedge</th><th className="num">Vol</th><th className="num">1σ impact</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.ccy}>
                    <td><Ccy code={r.ccy} /> <span className="dim" style={{ fontSize: 12, marginLeft: 4 }}>{market.meta[r.ccy].name}</span></td>
                    <td className="num">{usd(r.revenue)}</td>
                    <td className="num">{usd(r.cost)}</td>
                    <td className={`num ${r.net >= 0 ? '' : 'neg'}`}>{usd(r.net)}</td>
                    <td className="num">{r.natural.toFixed(0)}%</td>
                    <td className="num">{(r.vol * 100).toFixed(1)}%</td>
                    <td className="num">{usd(r.oneSigma)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </>
  )
}
