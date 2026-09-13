import type { ForestModel, ForestTree } from "@/lib/forest";

/**
 * 森の形を計算する。React から切り離して純粋関数にしてあるのは、
 * 「中間目標が n 個なら小枝が n 本」「落ち葉は今回は終わりにした数だけ」
 * という見た目の約束をテストで固定するため（tests/forest.test.mjs）。
 *
 * 乱数は目標・中間目標の id から決める。開くたびに枝ぶりが変わると、
 * 自分の木として覚えられない。
 */

export const VIEW_W = 400;
export const GROUND_Y = 290;

/** 根（価値観）の色。明暗どちらの地面の上でも読める中間の明るさにしてある */
export const VALUE_COLORS = ["#D39B2A", "#3A9C94", "#D46F86", "#8A7BD1", "#5B8FD6", "#8F9A4E"];

type Pt = [number, number];

export interface WoodShape { d: string; hi: string | null; hiW: number }
export interface LeafShape { d: string; fill: string; transform: string }
export interface Ellipse { cx: number; cy: number; rx: number; ry: number }
export interface BudShape { cx: number; cy: number; r: number; sw: number }
export interface FlowerShape { cx: number; cy: number; r: number; petals: { cx: number; cy: number; r: number }[] }
export interface FruitShape { x: number; y: number; s: number }
export interface RootShape { d: string; color: string; cardId: string }
export interface NodeShape { cx: number; cy: number; r: number; color: string; label: string; ly: number; index: number }
export interface TreeHit { cardId: string; x: number; y: number; w: number; h: number; labelX: number; labelY: number; label: string }

export interface ForestDrawing {
  height: number;
  grass: string;
  roots: RootShape[];
  nodes: NodeShape[];
  fallen: string[];
  shade: Ellipse[];
  wood: WoodShape[];
  leaves: LeafShape[];
  buds: BudShape[];
  flowers: FlowerShape[];
  fruits: FruitShape[];
  hits: TreeHit[];
}

const deg = Math.PI / 180;
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const f1 = (n: number) => n.toFixed(1);

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
function rand(seed: number, a: number, b = 0): number {
  let h = Math.imul(seed ^ Math.imul(a + 7, 668265263), 374761393) ^ Math.imul(b + 3, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function limb(p0: Pt, ang: number, len: number, bend: number, segs: number): Pt[] {
  const dx = Math.sin(ang), dy = -Math.cos(ang);
  const p1: Pt = [p0[0] + dx * len, p0[1] + dy * len];
  const c: Pt = [(p0[0] + p1[0]) / 2 + Math.cos(ang) * bend * len, (p0[1] + p1[1]) / 2 + Math.sin(ang) * bend * len];
  const pts: Pt[] = [];
  for (let k = 0; k <= segs; k++) {
    const t = k / segs, u = 1 - t;
    pts.push([u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0], u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1]]);
  }
  return pts;
}

function at(pts: Pt[], s: number): { p: Pt; ang: number } {
  const f = clamp(s, 0, 1) * (pts.length - 1);
  const k = Math.min(pts.length - 2, Math.floor(f));
  const t = f - k, a = pts[k], b = pts[k + 1];
  return { p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], ang: Math.atan2(b[0] - a[0], -(b[1] - a[1])) };
}

function wood(pts: Pt[], w0: number, w1: number): WoodShape {
  const n = pts.length, L: Pt[] = [], R: Pt[] = [], H: Pt[] = [];
  for (let k = 0; k < n; k++) {
    const a = pts[Math.max(0, k - 1)], b = pts[Math.min(n - 1, k + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1];
    const m = Math.hypot(tx, ty) || 1;
    tx /= m; ty /= m;
    const w = (w0 + (w1 - w0) * k / (n - 1)) / 2;
    L.push([pts[k][0] - ty * w, pts[k][1] + tx * w]);
    R.push([pts[k][0] + ty * w, pts[k][1] - tx * w]);
    H.push([pts[k][0] - ty * w * 0.45, pts[k][1] + tx * w * 0.45]);
  }
  const p = (q: Pt) => `${f1(q[0])},${f1(q[1])}`;
  return {
    d: `M${L.map(p).join("L")}L${p(pts[n - 1])}L${R.reverse().map(p).join("L")}Z`,
    hi: w0 > 3 ? H.map(p).join(" ") : null,
    hiW: Math.max(0.6, w0 * 0.13),
  };
}

function leafColor(maturity: number, vigor: number, r: number): string {
  if (vigor < 0.35 && r < (0.35 - vigor) / 0.4) {
    return `hsl(${(40 + r * 14).toFixed(0)},55%,${(50 + r * 6).toFixed(0)}%)`;
  }
  const hue = 80 + 26 * maturity + (r - 0.5) * 18;
  const sat = 50 - 8 * maturity + (r - 0.5) * 12;
  const lig = 55 - 19 * maturity + (r - 0.5) * 10;
  return `hsl(${hue.toFixed(0)},${sat.toFixed(0)}%,${lig.toFixed(0)}%)`;
}

function leaf(x: number, y: number, ang: number, size: number, fill: string): LeafShape {
  const a = size * 0.3, b = size * 0.75, c = size * 0.34;
  return {
    d: `M0,0C${f1(a)},${f1(-c)} ${f1(b)},${f1(-c)} ${f1(size)},0C${f1(b)},${f1(c)} ${f1(a)},${f1(c)} 0,0Z`,
    fill,
    transform: `translate(${f1(x)},${f1(y)}) rotate(${(ang / deg - 90).toFixed(0)})`,
  };
}

function flower(x: number, y: number, s: number): FlowerShape {
  const petals = Array.from({ length: 5 }, (_, k) => {
    const a = k * 72 * deg;
    return { cx: x + Math.sin(a) * 3.6 * s, cy: y - Math.cos(a) * 3.6 * s, r: 3 * s };
  });
  return { cx: x, cy: y, r: 1.9 * s, petals };
}

/** 地下の根（価値観）を置く位置。数に応じて横に並べ、ラベルが重ならないよう上下に互い違いにする */
function nodePositions(n: number, bottom: number): Pt[] {
  return Array.from({ length: n }, (_, k) => [VIEW_W * (k + 1) / (n + 1), bottom - 46 + (k % 2) * 16] as Pt);
}

export function drawForest(model: ForestModel, opts: { single?: boolean } = {}): ForestDrawing {
  const single = Boolean(opts.single);
  const height = single ? 390 : 400;
  const out: ForestDrawing = {
    height, grass: "", roots: [], nodes: [], fallen: [], shade: [], wood: [], leaves: [], buds: [], flowers: [], fruits: [], hits: [],
  };

  let grass = "";
  for (let x = 3; x < VIEW_W; x += 6) {
    const r = rand(x, 3, 3);
    grass += `M${x},${GROUND_Y + 2}q${f1(1 + r * 2)},${f1(-4 - r * 6)} ${f1(2 + r * 3)},${f1(-7 - r * 7)}`;
  }
  out.grass = grass;

  const nodes = nodePositions(model.values.length, height);
  model.values.forEach((v, k) => {
    const st = model.strength[k] ?? 0;
    out.nodes.push({
      cx: nodes[k][0], cy: nodes[k][1], r: 4 + Math.min(8, st * 0.8),
      color: VALUE_COLORS[k % VALUE_COLORS.length],
      label: v.length > 7 ? `${v.slice(0, 7)}…` : v,
      ly: nodes[k][1] + 21, index: k,
    });
  });

  const m = model.trees.length;
  const sc = single ? 1.35 : m > 4 ? 0.75 : m > 3 ? 0.92 : m > 2 ? 1.15 : 1.25;
  const spacing = VIEW_W / (m + 1);

  model.trees.forEach((t, idx) => {
    const seed = hashStr(t.cardId);
    const x = spacing * (idx + 1);
    drawTree(out, t, seed, x, sc, spacing);
    t.links.forEach((k) => {
      const e = nodes[k];
      out.roots.push({
        d: `M${f1(x)},${GROUND_Y + 6}C${f1(x)},${GROUND_Y + 50} ${f1(e[0])},${f1(e[1] - 30)} ${f1(e[0])},${f1(e[1])}`,
        color: VALUE_COLORS[k % VALUE_COLORS.length],
        cardId: t.cardId,
      });
    });
    out.hits[idx].labelY = GROUND_Y + 22 + (single ? 0 : (idx % 2) * 14);
  });

  return out;
}

function drawTree(out: ForestDrawing, t: ForestTree, seed: number, x: number, sc: number, spacing: number) {
  const ageFactor = clamp(0.35 + t.ageDays / 210, 0, 1);
  const h = (45 + 120 * t.growth * ageFactor) * sc;
  const w0 = (3 + 11 * clamp(t.ageDays / 280, 0.1, 1)) * sc;
  const w1 = 1.4 * sc;
  const base: Pt = [x, GROUND_Y + 2];
  const trunk = limb(base, (rand(seed, 4, 4) - 0.5) * 0.12, h, (rand(seed, 4, 5) - 0.5) * 0.1, 12);
  out.wood.push(wood(trunk, w0, w1));
  const widthAt = (s: number) => w0 + (w1 - w0) * s;

  t.twigs.forEach((tw, j) => {
    const ts = hashStr(tw.id);
    const s = Math.min(0.94, 0.3 + j * 0.058);
    const P = at(trunk, s);
    const side = j % 2 ? 1 : -1;
    const ang = P.ang + side * (48 + rand(ts, 5) * 20) * deg;
    const len = (22 + 14 * rand(ts, 6)) * sc * clamp(0.45 + tw.maturity * 1.2, 0.45, 1);
    const pts = limb(P.p, ang, len, (rand(ts, 1, 1) > 0.5 ? 1 : -1) * 0.14, 5);
    out.wood.push(wood(pts, Math.max(0.9, widthAt(s) * 0.45), 0.4));

    const nLeaves = tw.state === "fallen" ? 0 : Math.round((2 + 9 * t.vigor) * tw.maturity);
    for (let q = 0; q < nLeaves; q++) {
      const r = rand(ts, q, 7);
      const ls = nLeaves === 1 ? 1 : 0.3 + 0.7 * q / (nLeaves - 1);
      const L = at(pts, ls);
      out.leaves.push(leaf(L.p[0], L.p[1], L.ang + (q % 2 ? 1 : -1) * (35 + 30 * r) * deg, (5 + 4 * r + 2.5 * tw.maturity) * sc, leafColor(tw.maturity, t.vigor, rand(ts, q, 8))));
    }
    const T = at(pts, 1);
    if (nLeaves > 5) out.shade.push({ cx: (T.p[0] + P.p[0]) / 2, cy: (T.p[1] + P.p[1]) / 2, rx: len * 0.6, ry: len * 0.42 });

    if (tw.state === "bud") out.buds.push({ cx: T.p[0], cy: T.p[1], r: 3.2 * sc, sw: 1.8 * sc });
    else if (tw.state === "flower") out.flowers.push(flower(T.p[0], T.p[1], sc));
    else if (tw.state === "fallen") {
      const r = rand(ts, 9);
      out.fallen.push(`translate(${f1(x + (r - 0.5) * spacing * 0.8)},${f1(GROUND_Y + 1 + rand(ts, 10) * 9)}) rotate(${(rand(ts, 11) * 360).toFixed(0)})`);
    }
  });

  // 梢の葉。小枝（データ）とは別に、幹の上のほうへ散らす。これが無いと中間目標が少ない木が枯れ木に見える
  const E = at(trunk, 1);
  const nTop = Math.round(4 + 10 * t.vigor * t.growth);
  for (let q = 0; q < nTop; q++) {
    const r = rand(seed, q, 30);
    const P = at(trunk, 0.72 + 0.28 * rand(seed, q, 32));
    const side = q % 2 ? 1 : -1;
    out.leaves.push(leaf(P.p[0], P.p[1], P.ang + side * (15 + 60 * r) * deg, (6.5 + 4 * r) * sc, leafColor(t.growth, t.vigor, rand(seed, q, 31))));
  }

  if (t.done) {
    [0.7, 0.82, 0.94].forEach((s, k) => {
      const P = at(trunk, s);
      out.fruits.push({ x: P.p[0] + (k % 2 ? 9 : -9) * sc, y: P.p[1], s: sc });
    });
  }

  const top = E.p[1] - 20 * sc;
  out.hits.push({ cardId: t.cardId, x: x - spacing / 2, y: top, w: spacing, h: GROUND_Y + 30 - top, labelX: x, labelY: 0, label: t.label });
}
