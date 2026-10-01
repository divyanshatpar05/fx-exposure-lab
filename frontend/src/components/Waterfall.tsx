import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Tip } from './ui'

export interface Step { name: string; value: number; total?: boolean }

function toBars(steps: Step[]) {
  const out: { name: string; range: number[]; value: number; kind: 'total' | 'up' | 'down' }[] = []
  let run = 0
  for (const s of steps) {
    if (s.total) {
      run = s.value
      out.push({ name: s.name, range: [0, s.value], value: s.value, kind: 'total' })
    } else {
      const lo = run, hi = run + s.value
      run = hi
      out.push({ name: s.name, range: [Math.min(lo, hi), Math.max(lo, hi)], value: s.value, kind: s.value >= 0 ? 'up' : 'down' })
    }
  }
  return out
}

/** Floating-bar waterfall: totals are anchored at 0, deltas float from the running sum. */
export function Waterfall({ steps, fmt, height = 300 }: { steps: Step[]; fmt: (v: number) => string; height?: number }) {
  const data = toBars(steps)
  // Zoom the axis onto the region where things change, so small deltas stay
  // visible next to large totals (totals are clipped at the axis floor).
  const levels = data.flatMap((d) => (d.kind === 'total' ? [d.value] : d.range))
  const min = Math.min(...levels), max = Math.max(...levels)
  const span = max - min || Math.abs(max) || 1
  const pad = span * 0.12
  const lower = min >= 0 ? Math.max(0, min - span * 1.2) : min - pad

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 22, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="name" tickLine={false} axisLine={false} interval={0} tick={{ fontSize: 11 }} />
        <YAxis domain={[lower, max + pad]} tickFormatter={(v) => fmt(v)} width={64} allowDataOverflow />
        <Tooltip cursor={{ fill: 'rgba(96,165,250,.06)' }} content={<Tip rows={(p) => [[p.kind === 'total' ? 'Value' : 'Change', fmt(p.value as number), p.kind === 'down' ? 'neg' : p.kind === 'up' ? 'pos' : '']]} />} />
        <Bar dataKey="range" radius={[4, 4, 4, 4]} isAnimationActive={false}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.kind === 'total' ? '#60a5fa' : d.kind === 'up' ? '#34d399' : '#f87171'} fillOpacity={d.kind === 'total' ? 0.85 : 0.9} />
          ))}
          <LabelList dataKey="value" position="top" formatter={(v: unknown) => fmt(Number(v))} style={{ fill: '#8a9ab8', fontSize: 10.5, fontFamily: 'JetBrains Mono' }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
