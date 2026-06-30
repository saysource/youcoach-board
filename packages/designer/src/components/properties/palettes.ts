import type { StrokeStyle } from '@youcoach-board/core'

// Stroke width / style options for the Settings popover. (Color palettes live in
// ColorPickerWidget; the picker also collects colors in use from the document.)
export const STROKE_WIDTHS: { label: string; value: number }[] = [
  { label: 'Extra Thin', value: 1.5 },
  { label: 'Thin', value: 3 },
  { label: 'Bold', value: 6 },
  { label: 'Extra Bold', value: 10 },
]

export const STROKE_STYLES: { label: string; value: StrokeStyle }[] = [
  { label: 'Solid', value: 'solid' },
  { label: 'Dashed', value: 'dashed' },
  { label: 'Dotted', value: 'dotted' },
]
