import { useEffect, useState } from 'react'

export type ThemeSetting = 'light' | 'dark' | 'system'

// Scoped, local theme state for the board shell. Unlike YouCoach App 2's
// useTheme (which toggles `.dark` on document.documentElement), this never
// touches the host document: BoardShell applies the resolved `dark` class to
// its OWN root wrapper.
//
// Two modes:
//   - Uncontrolled (default): seed once from `initial`; the in-menu switch
//     drives it; `'system'` follows the OS.
//   - Controlled: pass `controlled` to let the host own the theme (e.g. mirror
//     App2's light/dark). The controlled value always wins for the resolved
//     theme, and prop changes sync live — so flipping the host theme while the
//     board is mounted updates the board.
export function useTheme(initial: ThemeSetting = 'system', controlled?: ThemeSetting) {
  const [internal, setInternal] = useState<ThemeSetting>(controlled ?? initial)
  const [systemDark, setSystemDark] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches,
  )

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  // Mirror host-controlled changes into local state so the value stays coherent
  // if control is later dropped (the resolved `theme` below already prefers it).
  useEffect(() => {
    if (controlled !== undefined) setInternal(controlled)
  }, [controlled])

  const theme = controlled ?? internal
  const isDark = theme === 'dark' || (theme === 'system' && systemDark)
  return { theme, setTheme: setInternal, isDark }
}
