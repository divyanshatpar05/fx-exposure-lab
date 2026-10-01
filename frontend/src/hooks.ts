import { useEffect, useRef, useState } from 'react'

/**
 * Run an async loader whenever `deps` change (debounced), keeping the previous
 * result on screen while the next one loads so charts don't flicker.
 */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[], delay = 150) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const seq = useRef(0)

  useEffect(() => {
    const id = ++seq.current
    setLoading(true)
    const t = setTimeout(() => {
      loader()
        .then((d) => { if (id === seq.current) { setData(d); setError(null) } })
        .catch((e: Error) => { if (id === seq.current) setError(e.message) })
        .finally(() => { if (id === seq.current) setLoading(false) })
    }, delay)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { data, loading, error }
}
