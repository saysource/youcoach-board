import { createInstance, type i18n as I18n } from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from '../i18n/en.json'
import it from '../i18n/it.json'

// The board's OWN i18next instance (never the global singleton — a host app
// may run its own i18next). Translations use NATURAL ENGLISH KEYS: the English
// string IS the key, so data-driven labels (catalog.json names, field-zone
// labels, hotkey tables) stay plain English in their sources and are wrapped
// with t(label) at the render site. en.json is the identity map (regenerated
// by scripts/i18n-extract.mjs); it.json maps English → Italian.

export const SUPPORTED_LANGUAGES = ['en', 'it'] as const

/** The board's UI language: the host's init parameter wins, then the page URL
 *  ?lang=…, then English. Unsupported values fall back to English. */
export function resolveLanguage(prop?: string | null): string {
  const fromUrl = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('lang') : null
  const want = (prop || fromUrl || 'en').toLowerCase()
  const base = want.split('-')[0]
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(base) ? base : 'en'
}

export const i18n: I18n = createInstance()
i18n.use(initReactI18next)
void i18n.init({
  resources: { en: { translation: en }, it: { translation: it } },
  lng: resolveLanguage(),
  fallbackLng: 'en',
  supportedLngs: [...SUPPORTED_LANGUAGES],
  nonExplicitSupportedLngs: true, // 'it-IT' → 'it'
  // Natural keys: dots and colons are ordinary characters, not separators.
  keySeparator: false,
  nsSeparator: false,
  interpolation: { escapeValue: false }, // React already escapes
  returnEmptyString: false, // an untranslated ('') entry falls back to the key
  initAsync: false, // resources are embedded — init synchronously
})

/** Bound translate for non-component code (alerts, imperative messages). */
export const t = i18n.t.bind(i18n)
