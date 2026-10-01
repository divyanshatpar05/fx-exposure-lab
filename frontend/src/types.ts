export type Instrument = 'none' | 'forward' | 'option'
export interface Hedge { ratio: number; instrument: Instrument }
export type Hedges = Record<string, Hedge>
export type Moves = Record<string, number>

export interface Market {
  as_of: string
  source: 'live' | 'cache' | 'fallback'
  currencies: string[]
  meta: Record<string, { name: string; flag: string }>
  spot: Record<string, number>
  vol: Record<string, number>
  corr: number[][]
  change_1y: Record<string, number>
  policy_rates: Record<string, number>
  history: Record<string, { d: string; v: number }[]>
}

export interface CompanySummary {
  ticker: string
  name: string
  sector: string
  revenue: number
  foreign_revenue_share: number
}

export interface ExposureRow { revenue: number; cost: number; net: number }

export interface ImpactRow {
  ccy: string; move: number; d_revenue: number; d_cost: number
  d_op: number; hedge_pnl: number; d_op_hedged: number
}

export interface Impact {
  rows: ImpactRow[]
  d_revenue: number; d_cost: number; d_op: number; hedge_pnl: number; d_op_hedged: number
  revenue_after: number; op_after: number
  d_revenue_pct: number; d_op_pct: number; d_op_hedged_pct: number
}

export interface CompanyDetail extends CompanySummary {
  blurb: string
  op_margin: number; op_income: number; tax_rate: number
  debt: number; floating_share: number; refi_share: number; avg_rate: number; net_debt: number
  fcf: number; shares: number; wacc: number; growth: number
  revenue_mix: Record<string, number>
  cost_mix: Record<string, number>
  exposure: Record<string, ExposureRow>
  narrative: string[]
  var95: number
  usd10: Impact
}

export interface Valuation {
  rate_bps: number; repriced_share: number; d_interest: number; interest_base: number
  fcf_base: number; fcf_new: number; wacc_base: number; wacc_new: number
  ev_base: number; ev_new: number; per_share_base: number; per_share_new: number
  value_change_pct: number; eps_base: number; eps_new: number; eps_change_pct: number
  bridge: { step: string; value: number }[]
}

export interface TornadoRow { ccy: string; up: number; down: number; up_hedged: number; down_hedged: number }
export interface HedgeRow { ccy: string; net: number; ratio: number; instrument: Instrument; cost: number; vol: number }

export interface Analysis {
  impact: Impact
  tornado: TornadoRow[]
  valuation: Valuation
  hedges: HedgeRow[]
  total_hedge_cost: number
}

export interface RiskStats {
  mean: number; std: number; var95: number; var99: number; cvar95: number
  p_loss_5: number; p_gain_5: number; var95_usd: number
  percentiles: Record<string, number>
}

export interface Simulation {
  n_paths: number; horizon: number; base_op: number
  histogram: { x: number; unhedged: number; hedged: number }[]
  unhedged: RiskStats; hedged: RiskStats
  risk_contrib: { ccy: string; share: number }[]
  risk_contrib_hedged: { ccy: string; share: number }[]
  hedge_cost: number
}

export interface FrontierPoint { ratio: number; var95: number; std: number; cost: number; cost_pct: number }
export interface Frontier { forward: FrontierPoint[]; option: FrontierPoint[] }

export interface Scenario {
  id: string; name: string; period: string; rate_bps: number; description: string
  moves: Moves
}
export interface StressResult extends Scenario { impact: Impact; valuation: Valuation }

export interface Surface { usd_moves: number[]; rate_moves: number[]; grid: number[][] }

export interface CompareRow {
  ticker: string; name: string; sector: string
  foreign_revenue_share: number; usd10_op_pct: number; var95: number; top_ccy: string
  net_exposure_ratio: number; rate100_value_pct: number; op_margin: number
}
