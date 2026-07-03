// A tiny planar-homography solver (Direct Linear Transform, least-squares).
//
// Given >=4 point correspondences src_i -> dst_i, find the 3x3 matrix H (up to
// scale) with dst ~ H * src. We fix H[8] = 1 (valid whenever no source point
// maps to infinity — true for pitch calibration, whose centre maps to a finite
// image point) and solve the resulting linear least-squares by normal equations
// + Gaussian elimination. Row-major, no dependencies.

export interface Pt {
  x: number
  y: number
}

/** Solve H (row-major length-9, H[8]=1) so dst ~ H·src. Needs >=4 correspondences
 *  (no 3 source points collinear); more are averaged in least-squares. */
export function solveHomography(src: Pt[], dst: Pt[]): number[] {
  const n = Math.min(src.length, dst.length)
  if (n < 4) throw new Error('homography needs at least 4 point pairs')
  // Build the 2n×8 system M·h = b for h = [h0..h7] (with h8 fixed to 1):
  //   u = h0·x + h1·y + h2 − h6·x·u − h7·y·u
  //   v = h3·x + h4·y + h5 − h6·x·v − h7·y·v
  const M: number[][] = []
  const b: number[] = []
  for (let i = 0; i < n; i++) {
    const { x, y } = src[i]
    const { x: u, y: v } = dst[i]
    M.push([x, y, 1, 0, 0, 0, -x * u, -y * u])
    b.push(u)
    M.push([0, 0, 0, x, y, 1, -x * v, -y * v])
    b.push(v)
  }
  // Normal equations: (Mᵀ M) h = Mᵀ b  → 8×8 symmetric system.
  const A: number[][] = Array.from({ length: 8 }, () => new Array(8).fill(0))
  const rhs = new Array(8).fill(0)
  for (let r = 0; r < M.length; r++) {
    const row = M[r]
    for (let i = 0; i < 8; i++) {
      rhs[i] += row[i] * b[r]
      for (let j = 0; j < 8; j++) A[i][j] += row[i] * row[j]
    }
  }
  const h = solveLinear(A, rhs)
  return [...h, 1]
}

/** Apply a row-major 3×3 homography to a point. */
export function applyHomography(H: number[], p: Pt): Pt {
  const w = H[6] * p.x + H[7] * p.y + H[8]
  return {
    x: (H[0] * p.x + H[1] * p.y + H[2]) / w,
    y: (H[3] * p.x + H[4] * p.y + H[5]) / w,
  }
}

/** Per-point reprojection error (‖H·src − dst‖) and the RMS over all points. */
export function residuals(H: number[], src: Pt[], dst: Pt[]): { each: number[]; rms: number } {
  const each: number[] = []
  let sum = 0
  const n = Math.min(src.length, dst.length)
  for (let i = 0; i < n; i++) {
    const q = applyHomography(H, src[i])
    const d = Math.hypot(q.x - dst[i].x, q.y - dst[i].y)
    each.push(d)
    sum += d * d
  }
  return { each, rms: n ? Math.sqrt(sum / n) : 0 }
}

/** Compose two row-major 3×3 matrices: (A·B). */
export function multiply3(a: number[], b: number[]): number[] {
  const out = new Array(9).fill(0)
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) out[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c]
  return out
}

// Gaussian elimination with partial pivoting for a small dense system A·x = b.
function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length
  const m = A.map((row, i) => [...row, b[i]]) // augmented
  for (let col = 0; col < n; col++) {
    // Pivot: largest magnitude in this column.
    let piv = col
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r
    if (Math.abs(m[piv][col]) < 1e-12) throw new Error('degenerate correspondences (singular system)')
    ;[m[col], m[piv]] = [m[piv], m[col]]
    // Eliminate below.
    for (let r = col + 1; r < n; r++) {
      const f = m[r][col] / m[col][col]
      for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c]
    }
  }
  // Back-substitution.
  const x = new Array(n).fill(0)
  for (let r = n - 1; r >= 0; r--) {
    let s = m[r][n]
    for (let c = r + 1; c < n; c++) s -= m[r][c] * x[c]
    x[r] = s / m[r][r]
  }
  return x
}
