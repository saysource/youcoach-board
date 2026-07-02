import { useEffect, useState, type ReactNode } from 'react'
import { AssetsContext, makeResolver, expandAggregateCategories, type AssetsConfig, type Catalog } from './assets'

// Provides asset resolution + the loaded catalog. The catalog is fetched once
// per config (keyed on its resolution inputs, so an inline config object doesn't
// re-fetch every render); state resets render-phase when that key changes.
export function AssetsProvider({ config, children }: { config?: AssetsConfig; children: ReactNode }) {
  const url = makeResolver(config)
  const catalogPath = config?.catalog ?? 'catalog.json'
  const key = `${config?.urlTemplate ?? ''}|${config?.resolve ? 'fn' : ''}|${catalogPath}`

  const [state, setState] = useState<{ key: string; catalog: Catalog | null; error: string | null }>({ key, catalog: null, error: null })
  if (state.key !== key) setState({ key, catalog: null, error: null })

  useEffect(() => {
    let cancelled = false
    fetch(makeResolver(config)(catalogPath))
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
        return r.json()
      })
      .then((c: Catalog) => {
        const expanded = expandAggregateCategories(c)
        if (!cancelled) setState((s) => (s.key === key ? { ...s, catalog: expanded } : s))
      })
      .catch((e: unknown) => {
        if (!cancelled) setState((s) => (s.key === key ? { ...s, error: e instanceof Error ? e.message : String(e) } : s))
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return <AssetsContext.Provider value={{ url, catalog: state.catalog, catalogError: state.error }}>{children}</AssetsContext.Provider>
}
