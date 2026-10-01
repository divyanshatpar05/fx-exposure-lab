import type { Market } from '../types'
import { pct, tone } from '../format'
import { Sparkline } from './ui'

const fmtSpot = (c: string, v: number) => (['EUR', 'GBP', 'AUD'].includes(c) ? (1 / v).toFixed(4) : v.toFixed(v > 100 ? 2 : 4))
const pair = (c: string) => (['EUR', 'GBP', 'AUD'].includes(c) ? `${c}/USD` : `USD/${c}`)

export function Tape({ market }: { market: Market }) {
  const items = market.currencies.map((c) => (
    <span className="tape-item" key={c}>
      <span>{market.meta[c].flag}</span>
      <span className="pair">{pair(c)}</span>
      <span className="px">{fmtSpot(c, market.spot[c])}</span>
      <Sparkline data={market.history[c] ?? []} width={46} height={14} />
      <span className={`mono ${tone(market.change_1y[c])}`} title={`${c} vs USD, 1 year`}>{pct(market.change_1y[c])}</span>
      <span className="dim mono">σ {(market.vol[c] * 100).toFixed(1)}%</span>
    </span>
  ))
  return (
    <div className="tape" aria-label="Live FX rates">
      <div className="tape-track">{items}{items.map((el, i) => <span key={`d${i}`} aria-hidden>{el}</span>)}</div>
    </div>
  )
}
