import defaultFieldImage from '../assets/field0.jpg'

// The bundled default grass image. Its URL is BUILD-SPECIFIC — the dev server
// serves it at `/src/assets/field0.jpg`, a production build at a hashed
// `/assets/field0-<hash>.jpg` — so a URL saved by one build 404s in another
// (e.g. a doc saved in dev, opened from the Drupal build). Documents therefore
// must not pin one build's URL: on load we repair any reference to the bundled
// default to THIS build's actual URL.
export const DEFAULT_FIELD_IMAGE = defaultFieldImage

// Recognizes the bundled default across builds: an `assets/field0….jpg` path,
// optionally under `/src` (dev) and optionally hashed (prod). Custom user images
// (data: URIs, uploads, external URLs) won't match this shape.
const DEFAULT_FIELD_IMAGE_RE = /(^|\/)(src\/)?assets\/field0[^/]*\.jpe?g(\?.*)?$/i

/** True if `url` points at the bundled default grass image (from any build). */
export function isDefaultFieldImage(url: string | null | undefined): boolean {
  if (!url) return false
  return url === DEFAULT_FIELD_IMAGE || DEFAULT_FIELD_IMAGE_RE.test(url)
}

/** Repair a stored `background.image`: a reference to the bundled default (from
 *  any build) becomes this build's actual URL; a custom image or an explicit
 *  `null` (a plain colored surface — e.g. futsal) is left untouched. */
export function resolveFieldImage(url: string | null | undefined): string | null {
  if (url == null) return null
  return isDefaultFieldImage(url) ? DEFAULT_FIELD_IMAGE : url
}
