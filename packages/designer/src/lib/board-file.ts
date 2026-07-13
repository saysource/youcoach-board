// Open / Save of board documents as JSON files (specs/animation.md).
//
// The on-disk format is exactly `serializeBoard` — the top-level `version`
// property identifies a YouCoach Board file (v3 = this designer's format;
// v2 = the old jQuery editor's, to get a dedicated converter later).

import { parseBoard, serializeBoard, type BoardDoc } from '@youcoach-board/core'
import type { EditorStore } from '../store/editorStore'
import { t } from './i18n'
import { stopPlayback } from './animation-playback'
import { resolveFieldImage } from './field-image'
import { convertV2Board, isV1Board, isV2Board } from './v2-convert'

/** Load a (raw, already JSON-parsed) document into the editor: stop playback,
 *  parse defensively, reset history/selection — and always land on the FIRST
 *  frame (the main drawing), whatever frame the file was saved on. */
export function loadBoard(store: EditorStore, raw: unknown): void {
  stopPlayback(store)
  const doc = parseBoard(raw)
  doc.animation.current = 0
  // Repair a background image saved by a different build (e.g. dev's
  // /src/assets/field0.jpg → this build's hashed default) so it doesn't 404.
  doc.background.image = resolveFieldImage(doc.background.image)
  store.setState({ doc, selectedIds: [], stack: [], pointer: -1, currentFrame: 0 })
}

/** Inspect a parsed file and load it if it's one of ours. Returns an error
 *  message for the user, or null on success. */
export function applyOpenedBoard(store: EditorStore, text: string): string | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return t('This file is not a valid YouCoach Board document (invalid JSON).')
  }
  // Old drawings run through the dedicated converter first: v2 declares
  // `version: 2`, v1 has no version at all and is recognized by its structure.
  if (isV2Board(raw) || isV1Board(raw)) {
    loadBoard(store, convertV2Board(raw))
    return null
  }
  const version = (raw as { version?: unknown } | null)?.version
  if (version === undefined || version === null) return t('This file is not a YouCoach Board document (missing "version").')
  loadBoard(store, raw)
  return null
}

/** "Open…": pick a .json file and load it. */
export function openBoardFromFile(store: EditorStore): void {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json,application/json'
  input.onchange = () => {
    const file = input.files?.[0]
    if (!file) return
    void file.text().then((text) => {
      const error = applyOpenedBoard(store, text)
      if (error) window.alert(error)
    })
  }
  input.click()
}

/** "Save to…": download the document as pretty-printed JSON (carries the
 *  identifying `version` property). Named after the drawing's title. */
export function saveBoardToFile(doc: BoardDoc): void {
  const blob = new Blob([serializeBoard(doc)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const name = (doc.title || 'drill').trim().replace(/[\\/:*?"<>|]+/g, '-') || 'drill'
  a.download = `${name}.json`
  a.click()
  // Give the browser a beat to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
