/** Format USD billions compactly: 1.234 → $1.23B, 0.0123 → $12.3M */
export function usd(bn: number, signed = false): string {
  const sign = bn < 0 ? '−' : signed && bn > 0 ? '+' : ''
  const a = Math.abs(bn)
  if (a >= 100) return `${sign}$${a.toFixed(0)}B`
  if (a >= 1) return `${sign}$${a.toFixed(2)}B`
  if (a >= 0.001) return `${sign}$${(a * 1000).toFixed(a >= 0.1 ? 0 : 1)}M`
  if (a === 0) return '$0'
  return `${sign}$${(a * 1e6).toFixed(0)}K`
}

export function pct(x: number, digits = 1, signed = true): string {
  const sign = x < 0 ? '−' : signed && x > 0 ? '+' : ''
  return `${sign}${Math.abs(x).toFixed(digits)}%`
}

export function money(x: number, digits = 2): string {
  const sign = x < 0 ? '−' : ''
  return `${sign}$${Math.abs(x).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`
}

export function bps(x: number): string {
  return `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(0)} bp`
}

export const tone = (x: number, eps = 1e-9) => (x > eps ? 'pos' : x < -eps ? 'neg' : 'flat')

export const CCY_COLORS: Record<string, string> = {
  USD: '#94a3b8', EUR: '#60a5fa', GBP: '#a78bfa', JPY: '#f472b6', CNY: '#f87171',
  CHF: '#fb923c', CAD: '#fbbf24', AUD: '#34d399', INR: '#2dd4bf', BRL: '#a3e635',
  MXN: '#38bdf8', KRW: '#e879f9',
}
