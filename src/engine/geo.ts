/** Distances in metres on a local equirectangular projection. */

const R = 6_371_008.8;
const RAD = Math.PI / 180;

export function metres(
  lon1: number,
  lat1: number,
  lon2: number,
  lat2: number
): number {
  const x = (lon2 - lon1) * RAD * Math.cos(((lat1 + lat2) / 2) * RAD);
  const y = (lat2 - lat1) * RAD;
  return Math.sqrt(x * x + y * y) * R;
}

/** Cell size of the segment grid, in metres. */
const CELL_M = 200;

/**
 * Segments of a polyline bucketed in a grid, for nearest-segment lookups.
 * Coordinates are projected around the line's first point.
 */
class SegmentGrid {
  private cells = new Map<number, number[]>();
  private xs: Float64Array;
  private ys: Float64Array;
  readonly kx: number;
  readonly lon0: number;
  readonly lat0: number;

  constructor(coords: Float64Array) {
    const n = coords.length / 2;
    this.lon0 = coords[0];
    this.lat0 = coords[1];
    this.kx = Math.cos(this.lat0 * RAD) * RAD * R;
    this.xs = new Float64Array(n);
    this.ys = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      this.xs[i] = (coords[2 * i] - this.lon0) * this.kx;
      this.ys[i] = (coords[2 * i + 1] - this.lat0) * RAD * R;
    }
    for (let i = 0; i < Math.max(1, n - 1); i++) {
      const j = Math.min(i + 1, n - 1);
      const x0 = Math.floor(Math.min(this.xs[i], this.xs[j]) / CELL_M);
      const x1 = Math.floor(Math.max(this.xs[i], this.xs[j]) / CELL_M);
      const y0 = Math.floor(Math.min(this.ys[i], this.ys[j]) / CELL_M);
      const y1 = Math.floor(Math.max(this.ys[i], this.ys[j]) / CELL_M);
      for (let cx = x0; cx <= x1; cx++) {
        for (let cy = y0; cy <= y1; cy++) {
          const key = cellKey(cx, cy);
          let list = this.cells.get(key);
          if (!list) {
            this.cells.set(key, (list = []));
          }
          list.push(i);
        }
      }
    }
  }

  project(lon: number, lat: number): [number, number] {
    return [(lon - this.lon0) * this.kx, (lat - this.lat0) * RAD * R];
  }

  /** Distance from a projected point to the nearest segment. */
  nearest(px: number, py: number): number {
    const cx = Math.floor(px / CELL_M);
    const cy = Math.floor(py / CELL_M);
    let best = Infinity;
    // Grow the searched ring until a hit is closer than the ring's inner edge.
    for (let ring = 0; ring < 64; ring++) {
      for (let dx = -ring; dx <= ring; dx++) {
        for (let dy = -ring; dy <= ring; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) {
            continue;
          }
          for (const i of this.cells.get(cellKey(cx + dx, cy + dy)) ?? []) {
            best = Math.min(best, this.segment(i, px, py));
          }
        }
      }
      if (best <= ring * CELL_M) {
        return best;
      }
    }
    return best === Infinity ? this.scan(px, py) : best;
  }

  private scan(px: number, py: number): number {
    let best = Infinity;
    for (let i = 0; i < Math.max(1, this.xs.length - 1); i++) {
      best = Math.min(best, this.segment(i, px, py));
    }
    return best;
  }

  private segment(i: number, px: number, py: number): number {
    const j = Math.min(i + 1, this.xs.length - 1);
    const ax = this.xs[i];
    const ay = this.ys[i];
    const dx = this.xs[j] - ax;
    const dy = this.ys[j] - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - ax - t * dx, py - ay - t * dy);
  }
}

function cellKey(x: number, y: number): number {
  return (x + 0x8000) * 0x10000 + (y + 0x8000);
}

/** Largest distance from any point of `from` to the line `to`. */
function directed(from: Float64Array, grid: SegmentGrid): number {
  let worst = 0;
  for (let i = 0; i < from.length; i += 2) {
    const [x, y] = grid.project(from[i], from[i + 1]);
    worst = Math.max(worst, grid.nearest(x, y));
  }
  return worst;
}

/**
 * Hausdorff-style distance between two lines given as [lon, lat, ...]:
 * the largest distance from a vertex of either line to the other line.
 */
export function lineDistance(a: Float64Array, b: Float64Array): number {
  if (a.length < 2 || b.length < 2) {
    return a.length === b.length ? 0 : Infinity;
  }
  return Math.max(
    directed(a, new SegmentGrid(b)),
    directed(b, new SegmentGrid(a))
  );
}
