import type { ReactNode } from 'react'
import { CCY_COLORS } from '../format'

export function Panel({ title, subtitle, right, children, className = '' }: {
  title?: ReactNode; subtitle?: ReactNode; right?: ReactNode; children: ReactNode; className?: string
}) {
  return (
    <section className={`panel fade-in ${className}`}>
      {(title || right) && (
        <div className="panel-head">
          <div>
            {title && <h3>{title}</h3>}
            {subtitle && <p>{subtitle}</p>}
          </div>
          {right}
        </div>
      )}
      {children}
    </section>
  )
}

export function Kpi({ label, value, sub, icon, variant, valueClass = '' }: {
  label: string; value: ReactNode; sub?: ReactNode; icon?: ReactNode; variant?: 'accent' | 'warn'; valueClass?: string
}) {
  return (
    <div className={`panel kpi fade-in ${variant ?? ''}`}>
      <div className="label">{icon}{label}</div>
      <div className={`value ${valueClass}`}>{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  )
}

export function Loading({ label = 'Crunching numbers…' }: { label?: string }) {
  return <div className="loading"><div className="spinner" /><span>{label}</span></div>
}

export function Ccy({ code }: { code: string }) {
  return (
    <span className="ccy-cell">
      <span className="swatch" style={{ background: CCY_COLORS[code] }} />
      {code}
    </span>
  )
}

export function Seg<T extends string | number>({ value, options, onChange }: {
  value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void
}) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={String(o.value)} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Generic Recharts tooltip with formatted rows. */
export function Tip({ active, payload, label, title, rows }: {
  active?: boolean
  payload?: { payload: Record<string, unknown> }[]
  label?: unknown
  title?: (p: Record<string, unknown>, label: unknown) => ReactNode
  rows: (p: Record<string, unknown>) => [string, ReactNode, string?][]
}) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  return (
    <div className="tooltip">
      <div className="tt-title">{title ? title(p, label) : String(label ?? '')}</div>
      {rows(p).map(([k, v, cls]) => (
        <div className="tt-row" key={k}><span>{k}</span><span className={cls}>{v}</span></div>
      ))}
    </div>
  )
}

export function Sparkline({ data, width = 64, height = 20 }: { data: { v: number }[]; width?: number; height?: number }) {
  if (!data?.length) return null
  const vs = data.map((d) => d.v)
  const min = Math.min(...vs), max = Math.max(...vs)
  const span = max - min || 1
  const pts = vs.map((v, i) => `${(i / (vs.length - 1)) * width},${height - ((v - min) / span) * (height - 2) - 1}`).join(' ')
  const up = vs[vs.length - 1] >= vs[0]
  return (
    <svg width={width} height={height} aria-hidden>
      <polyline points={pts} fill="none" stroke={up ? 'var(--pos)' : 'var(--neg)'} strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  )
}
