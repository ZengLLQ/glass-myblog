/**
 * Cut Pattern generator for Facet "Designed in glass" hero.
 * Generates 5 interlocking cell polygons with slow sine drift,
 * pointer push-away expansion, polygon insetting, and corner filleting.
 */

export class CutPattern {
  constructor() {
    // Base reference points in normalized coordinates [0, 1]
    this.base = {
      TL: [0, 0],
      TR: [1, 0],
      BR: [1, 1],
      BL: [0, 1],
      tAB: [0.22, 0],
      tBC: [0.515, 0],
      tCE: [0.84, 0],
      bAD: [0.34, 1],
      bDE: [0.865, 1],
      J0: [0.385, 0.72],
      J1: [0.48, 0.62],
      J2: [0.716, 0.49]
    };

    // Drift configurations: each point has periods (10-20s) and random phase
    this.drifts = {
      tAB: { px: 13.2, phx: 0.4 },
      tBC: { px: 16.7, phx: 1.8 },
      tCE: { px: 11.4, phx: 3.1 },
      bAD: { px: 14.8, phx: 2.2 },
      bDE: { px: 17.5, phx: 4.5 },
      J0:  { px: 12.1, phx: 0.9, py: 15.3, phy: 1.2 },
      J1:  { px: 18.3, phx: 2.7, py: 13.9, phy: 3.8 },
      J2:  { px: 15.1, phx: 4.1, py: 17.2, phy: 5.4 }
    };
  }

  /**
   * Evaluate live point positions at time t, with cursor push influence.
   * @param {number} t Time in seconds
   * @param {{x: number, y: number}|null} pointer Pointer in normalized panel coordinates [0, 1]
   * @param {boolean} isPortrait True if screen is in portrait aspect ratio
   */
  evaluatePoints(t, pointer, isPortrait = false) {
    const pts = {};

    // Corners stay anchored
    pts.TL = [...this.base.TL];
    pts.TR = [...this.base.TR];
    pts.BR = [...this.base.BR];
    pts.BL = [...this.base.BL];

    // Compute drifted positions
    for (const key of ['tAB', 'tBC', 'tCE', 'bAD', 'bDE']) {
      const cfg = this.drifts[key];
      const dx = Math.sin((t * 2 * Math.PI) / cfg.px + cfg.phx) * 0.03;
      const x = Math.max(0.05, Math.min(0.95, this.base[key][0] + dx));
      pts[key] = [x, this.base[key][1]];
    }

    for (const key of ['J0', 'J1', 'J2']) {
      const cfg = this.drifts[key];
      const dx = Math.sin((t * 2 * Math.PI) / cfg.px + cfg.phx) * 0.03;
      const dy = Math.sin((t * 2 * Math.PI) / cfg.py + cfg.phy) * 0.05;
      const x = Math.max(0.15, Math.min(0.85, this.base[key][0] + dx));
      const y = Math.max(0.15, Math.min(0.85, this.base[key][1] + dy));
      pts[key] = [x, y];
    }

    // Cursor push: points within 0.6 of pointer are pushed away by up to 0.05
    if (pointer && pointer.x >= -0.2 && pointer.x <= 1.2 && pointer.y >= -0.2 && pointer.y <= 1.2) {
      const px = pointer.x;
      const py = pointer.y;

      const movableKeys = ['tAB', 'tBC', 'tCE', 'bAD', 'bDE', 'J0', 'J1', 'J2'];
      for (const k of movableKeys) {
        const cur = pts[k];
        const vx = cur[0] - px;
        const vy = cur[1] - py;
        const dist = Math.hypot(vx, vy);

        if (dist > 0.001 && dist < 0.6) {
          const factor = (1 - dist / 0.6) * 0.05;
          const nx = vx / dist;
          const ny = vy / dist;

          if (k.startsWith('t') || k.startsWith('b')) {
            // Edge points slide along edge only (X-axis)
            cur[0] = Math.max(0.05, Math.min(0.95, cur[0] + nx * factor));
          } else {
            // Junctions move freely
            cur[0] = Math.max(0.12, Math.min(0.88, cur[0] + nx * factor));
            cur[1] = Math.max(0.12, Math.min(0.88, cur[1] + ny * factor));
          }
        }
      }
    }

    // Portrait transposition: transpose coordinates so hero cell sits on top
    if (isPortrait) {
      const trans = {};
      for (const [k, [x, y]] of Object.entries(pts)) {
        // Rotated/transposed: mapping (x, y) -> (y, x)
        trans[k] = [y, x];
      }
      return trans;
    }

    return pts;
  }

  /**
   * Get the 5 cell vertex lists in normalized coordinates
   */
  getCells(pts) {
    return {
      A: [pts.BL, pts.bAD, pts.J0, pts.tAB, pts.TL], // Hero cell
      B: [pts.J0, pts.J1, pts.tBC, pts.tAB],
      C: [pts.J1, pts.J2, pts.tCE, pts.tBC],
      D: [pts.bAD, pts.bDE, pts.J2, pts.J1, pts.J0],
      E: [pts.J2, pts.bDE, pts.BR, pts.TR, pts.tCE]
    };
  }

  /**
   * Inset a 2D counter-clockwise polygon by given distance
   */
  static insetPolygon(pts, inset) {
    const n = pts.length;
    const edges = [];
    for (let i = 0; i < n; i++) {
      const p1 = pts[i];
      const p2 = pts[(i + 1) % n];
      const dx = p2[0] - p1[0];
      const dy = p2[1] - p1[1];
      const len = Math.hypot(dx, dy);
      if (len < 1e-5) continue;
      // Inward normal for CCW polygon in (x, y_up)
      const nx = -dy / len;
      const ny = dx / len;
      edges.push({ p1, p2, dx: dx / len, dy: dy / len, nx, ny, len });
    }

    const m = edges.length;
    if (m < 3) return pts;

    const shifted = [];
    for (let i = 0; i < m; i++) {
      const prev = edges[(i - 1 + m) % m];
      const curr = edges[i];

      const x1 = prev.p1[0] + prev.nx * inset;
      const y1 = prev.p1[1] + prev.ny * inset;
      const dx1 = prev.dx;
      const dy1 = prev.dy;

      const x2 = curr.p1[0] + curr.nx * inset;
      const y2 = curr.p1[1] + curr.ny * inset;
      const dx2 = curr.dx;
      const dy2 = curr.dy;

      const det = dx1 * dy2 - dy1 * dx2;
      if (Math.abs(det) < 1e-5) {
        shifted.push([curr.p1[0] + curr.nx * inset, curr.p1[1] + curr.ny * inset]);
      } else {
        const t = ((x2 - x1) * dy2 - (y2 - y1) * dx2) / det;
        shifted.push([x1 + t * dx1, y1 + t * dy1]);
      }
    }
    return shifted;
  }

  /**
   * Calculate polygon centroid [cx, cy]
   */
  static getCentroid(pts) {
    let a = 0, cx = 0, cy = 0;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const factor = pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
      a += factor;
      cx += (pts[i][0] + pts[j][0]) * factor;
      cy += (pts[i][1] + pts[j][1]) * factor;
    }
    a /= 2;
    if (Math.abs(a) < 1e-6) return [0.5, 0.5];
    return [cx / (6 * a), cy / (6 * a)];
  }

  static buildFilletedShape(THREE, pts, radius) {
    const n = pts.length;
    const cmds = [];

    for (let i = 0; i < n; i++) {
      const prev = pts[(i - 1 + n) % n];
      const curr = pts[i];
      const next = pts[(i + 1) % n];

      const d1x = prev[0] - curr[0];
      const d1y = prev[1] - curr[1];
      const len1 = Math.hypot(d1x, d1y);
      const u1x = len1 > 1e-4 ? d1x / len1 : 0;
      const u1y = len1 > 1e-4 ? d1y / len1 : 0;

      const d2x = next[0] - curr[0];
      const d2y = next[1] - curr[1];
      const len2 = Math.hypot(d2x, d2y);
      const u2x = len2 > 1e-4 ? d2x / len2 : 0;
      const u2y = len2 > 1e-4 ? d2y / len2 : 0;

      const dot = Math.max(-0.999, Math.min(0.999, u1x * u2x + u1y * u2y));
      const angle = Math.acos(dot);
      const halfAngle = angle / 2;
      const tanHalf = Math.tan(halfAngle);
      let T = tanHalf > 1e-4 ? radius / tanHalf : 0;
      const maxT = Math.min(len1, len2) * 0.45;
      if (T > maxT) T = maxT;

      const startX = curr[0] + u1x * T;
      const startY = curr[1] + u1y * T;
      const endX = curr[0] + u2x * T;
      const endY = curr[1] + u2y * T;

      cmds.push({
        corner: curr,
        start: [startX, startY],
        end: [endX, endY]
      });
    }

    const shape = new THREE.Shape();
    if (cmds.length === 0) return shape;

    shape.moveTo(cmds[0].start[0], cmds[0].start[1]);
    for (let i = 0; i < cmds.length; i++) {
      const c = cmds[i];
      const next = cmds[(i + 1) % cmds.length];
      shape.quadraticCurveTo(c.corner[0], c.corner[1], c.end[0], c.end[1]);
      shape.lineTo(next.start[0], next.start[1]);
    }
    shape.closePath();
    return shape;
  }
}
