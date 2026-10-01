import type {
  Analysis, CompanyDetail, CompanySummary, CompareRow, Frontier, Hedges, Market, Moves,
  Simulation, StressResult, Surface,
} from './types'

const BASE = import.meta.env.VITE_API_URL ?? ''

async function req<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, body === undefined ? undefined : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
  return res.json() as Promise<T>
}

export const api = {
  market: () => req<Market>('/market'),
  companies: () => req<CompanySummary[]>('/companies'),
  company: (t: string) => req<CompanyDetail>(`/companies/${t}`),
  analyze: (ticker: string, moves: Moves, hedges: Hedges, rate_bps: number) =>
    req<Analysis>('/analyze', { ticker, moves, hedges, rate_bps }),
  simulate: (ticker: string, hedges: Hedges, n_paths: number, horizon: number, seed: number) =>
    req<Simulation>('/simulate', { ticker, hedges, n_paths, horizon, seed }),
  frontier: (ticker: string) => req<Frontier>('/frontier', { ticker }),
  stress: (ticker: string, hedges: Hedges) => req<StressResult[]>('/stress', { ticker, hedges }),
  surface: (ticker: string, hedges: Hedges) => req<Surface>('/surface', { ticker, hedges }),
  compare: (tickers: string[]) => req<CompareRow[]>('/compare', { tickers }),
}
