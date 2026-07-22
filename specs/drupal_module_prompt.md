# Prompt: create/evolve the `youcoach_board` Drupal 7 module

Use this brief in a Drupal-expert environment to (re)generate or extend the
`youcoach_board` module. A first version has already been scaffolded at
`sites/all/modules/saysource/youcoach_board/` — treat this as the spec of record
and reconcile against it.

## Goal
Let a **logged-in** YouCoach Drupal user run the full **YouCoach Board** designer (a
standalone React app) at `/youcoach-board`. The app is backend-free: it loads/saves
JSON and pulls every runtime asset through a module-provided **resource proxy**.
Nothing is rendered server-side except the HTML shell.

## Environment
- **Drupal 7.x**, module package `Saysource` (match sibling modules like `mycoach_ai`).
- Module dir: `sites/all/modules/saysource/youcoach_board/`.
- The React app + its assets are **built and copied in by the youcoach-board repo**
  (`yarn deploy:drupal`), NOT by Drupal. They land in:
  - `build/` — the compiled app: `index.html`, `.vite/manifest.json`, `assets/*`
    (hashed JS/CSS + code-split chunks). Web-accessible static files.
  - `resources/` — `catalog.json` + `images/optimized/**` (~78 MB). **Protected**
    by `resources/.htaccess` (deny all) so they're reachable *only* via the proxy.
  Both are git-ignored in the module; `resources/.htaccess` is tracked.

## Routes (`hook_menu`)
1. **`youcoach-board`** — access `user_is_logged_in`; full-page designer.
2. **`youcoach-board/resource`** — access `user_is_logged_in`; streams one file from
   `resources/` chosen by `?id=<relative-path>`.

## Page callback (`youcoach-board`)
Render a complete HTML document (bypass the Drupal theme — the app owns the whole
viewport) containing:
- `<div id="ycb-root" class="ycb-root"></div>` — the mount point. **The `ycb-root`
  class is mandatory**: the app's CSS is scoped to `.ycb-root`.
- The built CSS `<link>` and the built **ES-module** `<script type="module">`, whose
  hashed filenames come from `build/.vite/manifest.json` (`manifest['index.html'].file`
  and `.css[0]`). Prefix with `base_path() . drupal_get_path('module','youcoach_board') . '/build/'`.
- Settings for the app, passed via `drupal_add_js(array('youcoachBoard'=>…),'setting')`
  and mirrored to `window.__YCB_SETTINGS__` by the kickstarter `js/youcoach_board.js`
  (a classic script, so it runs before the deferred module entry). Emit the head
  scripts with `drupal_get_js()`.

### Settings shape (the app ↔ Drupal contract)
`window.__YCB_SETTINGS__` (all optional except `resourceBase`):
```
{
  resourceBase: string,        // URL template with a __path__ placeholder
  initialDoc?: object,         // a BoardDoc to open (else an empty board)
  theme?: 'light'|'dark'|'system',
  showThemeControl?: boolean
}
```
Build `resourceBase` from `url('youcoach-board/resource')`, appending `id=__path__`
with the correct separator (`?`/`&`) so it works with clean-URLs on **or** off, e.g.
`/youcoach-board/resource?id=__path__`. The app substitutes `__path__` per asset:
`catalog.json` → `…?id=catalog.json`,
`images/optimized/fields/11/10_mini.png` → `…?id=images/optimized/fields/11/10_mini.png`.

## Resource callback (`youcoach-board/resource`)
- Read `$_GET['id']`. **Reject** empty, any `..`, a leading `/`, or a NUL byte.
- Resolve within `resources/`: `realpath(base.'/'.$id)` must be a file whose real
  path starts with `realpath(resources/) . DIRECTORY_SEPARATOR`. Otherwise return
  `MENU_NOT_FOUND`.
- Stream with an extension-based `Content-Type` (json/png/jpg/svg/webp/gif/woff2 →
  `application/octet-stream` fallback), `Content-Length`, a private long
  `Cache-Control`, then `readfile()` + `drupal_exit()`.

## Files
- `youcoach_board.info` (`core = 7.x`, `package = Saysource`).
- `youcoach_board.module` (`hook_menu`, `hook_theme`, the two callbacks).
- `templates/youcoach_board.tpl.php` (the HTML shell; vars `$js_url`, `$css_url`).
- `js/youcoach_board.js` (kickstarter: `window.__YCB_SETTINGS__ = Drupal.settings.youcoachBoard || {}`).
- `resources/.htaccess` (deny direct access — `Require all denied` / `Deny from all`).

## Notes
- No DB schema needed (no `.install`).
- If `build/.vite/manifest.json` is missing, show a friendly "not deployed — run
  yarn deploy:drupal" message instead of a fatal error.
- **Out of scope (for now):** a server-side video-render API. Leave a placeholder
  route only if convenient.
- Future: a save endpoint (persist a drawing to the user's account) and passing an
  `initialDoc` when opening an existing drawing — both plug into the settings above.
