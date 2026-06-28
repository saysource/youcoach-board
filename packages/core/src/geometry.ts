// The board's coordinate system.
//
// All board content is authored in this fixed user-space, independent of the
// pixel size the SVG is finally rendered at — the <svg viewBox> maps these
// units to whatever box the host gives us (see BoardCanvas). Keeping a single,
// stable coordinate space is what lets element positions in the JSON document
// stay meaningful across zoom levels, embeds and export.
//
// The drawable board is a fixed 4:3 frame (per the spec), not an infinite
// canvas. 1200×900 gives generous integer room for field markings.
export const BOARD_WIDTH = 1200
export const BOARD_HEIGHT = 900
export const BOARD_ASPECT = BOARD_WIDTH / BOARD_HEIGHT
