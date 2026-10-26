/**
 * Homography Solver: Computes 3D perspective matrix (matrix3d)
 * to map a 2D DOM element onto 4 projected screen points in real time.
 */

export function solveHomography(src, dst) {
  // src and dst are arrays of 4 points: [{x, y}, {x, y}, {x, y}, {x, y}]
  // Maps src -> dst
  const A = [];
  const b = [];

  for (let i = 0; i < 4; i++) {
    const sx = src[i].x;
    const sy = src[i].y;
    const dx = dst[i].x;
    const dy = dst[i].y;

    A.push([sx, sy, 1, 0, 0, 0, -dx * sx, -dx * sy]);
    b.push(dx);

    A.push([0, 0, 0, sx, sy, 1, -dy * sx, -dy * sy]);
    b.push(dy);
  }

  // Solve 8x8 linear system using Gaussian elimination
  const n = 8;
  for (let i = 0; i < n; i++) {
    let maxRow = i;
    for (let r = i + 1; r < n; r++) {
      if (Math.abs(A[r][i]) > Math.abs(A[maxRow][i])) maxRow = r;
    }
    [A[i], A[maxRow]] = [A[maxRow], A[i]];
    [b[i], b[maxRow]] = [b[maxRow], b[i]];

    const pivot = A[i][i];
    if (Math.abs(pivot) < 1e-10) continue;

    for (let j = i; j < n; j++) A[i][j] /= pivot;
    b[i] /= pivot;

    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const factor = A[r][i];
      for (let j = i; j < n; j++) A[r][j] -= factor * A[i][j];
      b[r] -= factor * b[i];
    }
  }

  const [h00, h01, h02, h10, h11, h12, h20, h21] = b;

  // CSS matrix3d format (column-major 4x4 matrix):
  // [
  //   m00, m10, m20, m30,
  //   m01, m11, m21, m31,
  //   m02, m12, m22, m32,
  //   m03, m13, m23, m33
  // ]
  return [
    h00, h10, 0, h20,
    h01, h11, 0, h21,
    0,   0,   1, 0,
    h02, h12, 0, 1
  ];
}

export function toCSSMatrix3d(m) {
  return `matrix3d(${m.map(v => Number(v.toFixed(6))).join(',')})`;
}
