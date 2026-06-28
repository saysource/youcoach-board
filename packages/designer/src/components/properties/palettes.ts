import type { StrokeStyle } from '@youcoach-board/core'

// Small, Excalidraw-flavored palettes. Will be refined later.
export const STROKE_COLORS = ['#1e1e1e', '#e03131', '#2f9e44', '#1971c2', '#f08c00']
export const BG_COLORS = ['transparent', '#ffc9c9', '#b2f2bb', '#a5d8ff', '#ffec99']

export const STROKE_WIDTHS: { label: string; value: number }[] = [
  { label: 'Thin', value: 1.5 },
  { label: 'Bold', value: 3 },
  { label: 'Extra bold', value: 6 },
]

export const STROKE_STYLES: { label: string; value: StrokeStyle }[] = [
  { label: 'Solid', value: 'solid' },
  { label: 'Dashed', value: 'dashed' },
  { label: 'Dotted', value: 'dotted' },
]
