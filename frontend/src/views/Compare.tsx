import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts'
import { ArrowDownUp } from 'lucide-react'
import type { ViewProps } from '../App'
import { api } from '../api'
import { useAsync } from '../hooks'
import { Ccy, Loading, Panel, Tip } from '../components/ui'
import { pct, tone } from '../format'
import type { CompareRow } from '../types'

type Key = keyof CompareRow
const COLS: { key: Key; label: string; fmt: (r: CompareRow) => React.ReactNode; title?: string }[] = [
  { key: 'foreign_revenue_share', label: 'Foreign rev.', fmt: (r) => `${r.foreign_revenue_share.toFixed(0)}%` },
  { key: 'op_margin', label: 'Op. margin', fmt: (r) => `${r.op_margin.toFixed(0)}%` },
  { key: 'net_exposure_ratio', label: 'Net exp. / EBIT', fmt: (r) => `${r.net_exposure_ratio.toFixed(0)}%`, title: 'Gross net FX exposure as % of operating income' },
  { key: 'usd10_op_pct', label: 'USD +10%', fmt: (r) => <span className={tone(r.usd10_op_pct)}>{pct(r.usd10_op_pct)}</span>, title: 'Op. income change for a broad 10% USD rally' },
  { key: 'var95', label: 'FX VaR 95%', fmt: (r) => <span className="neg">{pct(-r.var95)}</span>, title: '1-year, unhedged, % of op. income' },
  { key: 'rate100_value_pct', label: 'Rates +100bp', fmt: (r) => <span className={tone(r.rate100_value_pct)}>{pct(r.rate100_value_pct)}</span>, title: 'Model equity value change' },
]

export default function Compare({ company, selectTicker, goTo }: ViewProps) {
  const { data } = useAsync(() => api.compare([]), [], 0)
  const [sort, setSort] = useState<{ key: Key; dir: 1 | -1 }>({ key: 'var95', dir: -1 })

  if (!data) return <Loading label="Simulating all companies…" />
  const rows = [...data].sort((a, b) => ((a[sort.key] as number) - (b[sort.key] as number)) * sort.dir)
  const usdBars = [...data].sort((a, b) => a.usd10_op_pct - b.usd10_op_pct)
  const open = (t: string) => { selectTicker(t); goTo('overview') }

  return (
    <>
      <div className="grid g-2">
        <Panel title="Currency fragility map" subtitle="More foreign revenue doesn't automatically mean more risk — local costs and margins decide. Click a dot to open the company.">
          <ResponsiveContainer width="100%" height={340}>
            <ScatterChart margin={{ top: 16, right: 24, bottom: 24, left: 0 }}>
              <CartesianGrid />
              <XAxis type="number" dataKey="foreign_revenue_share" domain={[30, 90]} tickFormatter={(v) => `${v}%`} label={{ value: 'Foreign revenue share', position: 'insideBottom', offset: -14 }} />
              <YAxis type="number" dataKey="var95" tickFormatter={(v) => `${v.toFixed(0)}%`} width={48} label={{ value: 'FX VaR 95%', angle: -90, position: 'insideLeft', offset: 12 }} />
              <ZAxis type="number" dataKey="op_margin" range={[80, 380]} />
              <Tooltip content={<Tip title={(p) => `${p.name} (${p.ticker})`} rows={(p) => [
                ['Foreign revenue', `${(p.foreign_revenue_share as number).toFixed(0)}%`],
                ['FX VaR 95%', pct(-(p.var95 as number))],
                ['Op. margin', `${(p.op_margin as number).toFixed(0)}%`],
                ['Top risk', String(p.top_ccy)],
              ]} />} />
              <Scatter data={data} onClick={(p) => open((p as unknown as CompareRow).ticker)} style={{ cursor: 'pointer' }}>
                {data.map((d) => <Cell key={d.ticker} fill={d.ticker === company.ticker ? '#fbbf24' : '#60a5fa'} fillOpacity={0.75} stroke={d.ticker === company.ticker ? '#fbbf24' : '#93c5fd'} />)}
                <LabelList dataKey="ticker" position="top" style={{ fill: '#cdd6e6', fontSize: 10.5, fontFamily: 'JetBrains Mono' }} />
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
          <p className="note">Bubble size = operating margin. Thin-margin businesses amplify FX swings in profit terms.</p>
        </Panel>

        <Panel title="Who gets hurt by a strong dollar?" subtitle="Operating-income change for a broad 10% USD rally, unhedged.">
          <ResponsiveContainer width="100%" height={360}>
            <BarChart data={usdBars} layout="vertical" margin={{ left: 0, right: 56 }}>
              <CartesianGrid horizontal={false} />
              <XAxis type="number" tickFormatter={(v) => `${v.toFixed(0)}%`} />
              <YAxis type="category" dataKey="ticker" width={52} tickLine={false} axisLine={false} />
              <ReferenceLine x={0} stroke="#2a3a5c" />
              <Tooltip cursor={{ fill: 'rgba(96,165,250,.06)' }} content={<Tip title={(p) => String(p.name)} rows={(p) => [['Op. income', pct(p.usd10_op_pct as number), 'neg']]} />} />
              <Bar dataKey="usd10_op_pct" radius={[4, 4, 4, 4]} onClick={(p) => open((p as unknown as CompareRow).ticker)} style={{ cursor: 'pointer' }}>
                {usdBars.map((d) => <Cell key={d.ticker} fill={d.ticker === company.ticker ? '#fbbf24' : '#f87171'} fillOpacity={0.85} />)}
                <LabelList dataKey="usd10_op_pct" position="right" formatter={(v: unknown) => pct(Number(v))} style={{ fill: '#8a9ab8', fontSize: 10.5, fontFamily: 'JetBrains Mono' }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Panel>
      </div>

      <Panel title="League table" subtitle="Click a column to sort, a row to open the company.">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Company</th><th>Sector</th>
                {COLS.map((c) => (
                  <th key={c.key} className="num sortable" title={c.title} onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? (s.dir === 1 ? -1 : 1) : -1 }))}>
                    {c.label} {sort.key === c.key && <ArrowDownUp size={10} style={{ verticalAlign: -1 }} />}
                  </th>
                ))}
                <th>Top risk</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.ticker} className={r.ticker === company.ticker ? 'hl' : ''} onClick={() => open(r.ticker)} style={{ cursor: 'pointer' }}>
                  <td><span className="mono" style={{ color: 'var(--accent)', fontWeight: 600, marginRight: 8 }}>{r.ticker}</span>{r.name}</td>
                  <td className="muted">{r.sector}</td>
                  {COLS.map((c) => <td key={c.key} className="num">{c.fmt(r)}</td>)}
                  <td><Ccy code={r.top_ccy} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  )
}
