/**
 * Image → outline tracing (clean-room, no external tracer).
 *
 *  1. Prepare: greyscale or colour reduction (k-means), noise clean-up
 *     (median + blur), optional background levelling for graduated backgrounds.
 *  2. Mask: threshold (auto = Otsu) or the colours you keep; erased pixels removed.
 *  3. Trace: every boundary between inside and outside pixels is linked into
 *     closed loops (outer edges and holes).
 *  4. Clean: loops smaller than the speck size are dropped, the pixel
 *     staircase is removed, then smoothed (Chaikin) and simplified
 *     (Douglas–Peucker) to the chosen detail.
 *
 * Coordinates are in pixels (x right, y down); the caller scales to mm.
 */
export interface Img { w: number; h: number; data: Uint8ClampedArray }
export interface TraceOpts {
  mode: 'silhouette' | 'colours';
  threshold: number | 'auto';
  invert: boolean;
  /** level out uneven / graduated backgrounds */
  flatten: boolean;
  fillHoles: boolean;
  colours: number;
  /** per palette colour: keep (true) or drop (false); missing = keep unless background */
  keep?: boolean[];
  /** colours mode: join kept colours into one silhouette */
  merge: boolean;
  /** 0–5: noise clean-up on the image */
  clean: number;
  /** 0–4: outline smoothing passes */
  smooth: number;
  /** drop pieces smaller than this area (px²) */
  speckPx: number;
  /** simplification tolerance in px (smaller = more detail) */
  tolPx: number;
  /** brush edits per pixel: 0 none, 1 erased (background), 2+k filled (silhouette: shape; colours: colour k) */
  erase?: Uint8Array;
}
export interface Loop { pts: { x: number; y: number }[]; area: number; colour: number; closed?: boolean }
export interface TraceResult { loops: Loop[]; palette: [number, number, number][]; background: number; backgrounds: number[]; threshold: number; points: number; diag: { found: number; largestPx: number; coverage: number; masks: number; keptColours: number } }

// ---------- image preparation ----------
export function toGrey(img: Img): Float32Array {
  const n = img.w * img.h, g = new Float32Array(n), d = img.data;
  for (let i = 0; i < n; i++) { const a = d[i * 4 + 3] / 255; g[i] = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) * a + 255 * (1 - a); }
  return g;
}
/** 3×3 median (removes salt-and-pepper speckle). */
export function median3(src: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(src.length), v = new Float32Array(9);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let k = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = Math.min(w - 1, Math.max(0, x + dx)), yy = Math.min(h - 1, Math.max(0, y + dy)); v[k++] = src[yy * w + xx]; }
    v.sort(); out[y * w + x] = v[4];
  }
  return out;
}
/** Separable box blur (radius r), repeated `passes` times ≈ Gaussian. */
export function boxBlur(src: Float32Array, w: number, h: number, r: number, passes = 2): Float32Array {
  if (r < 1) return src;
  let a = Float32Array.from(src), b = new Float32Array(src.length);
  const run = (get: (i: number) => number, set: (i: number, v: number) => void, n: number) => {
    let s = 0; for (let i = -r; i <= r; i++) s += get(Math.min(n - 1, Math.max(0, i)));
    for (let i = 0; i < n; i++) { set(i, s / (2 * r + 1)); s += get(Math.min(n - 1, i + r + 1)) - get(Math.max(0, i - r)); }
  };
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) run(i => a[y * w + i], (i, v) => { b[y * w + i] = v; }, w);
    for (let x = 0; x < w; x++) run(i => b[i * w + x], (i, v) => { a[i * w + x] = v; }, h);
  }
  return a;
}
/** Separable running max (or min) filter of radius r. */
function extremum(src: Float32Array, w: number, h: number, r: number, max: boolean): Float32Array {
  const pick = max ? Math.max : Math.min, tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let m = src[y * w + x]; for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) m = pick(m, src[y * w + k]); tmp[y * w + x] = m; }
  for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) { let m = tmp[y * w + x]; for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) m = pick(m, tmp[k * w + x]); out[y * w + x] = m; }
  return out;
}
/**
 * Level a graduated background: estimate the background with a wide max (or
 * min) filter + blur — worked out on a small copy for speed, then scaled back
 * up — and divide it out. Dark-on-light by default.
 */
export function flattenBackground(g: Float32Array, w: number, h: number, lightSubject: boolean): Float32Array {
  const f = Math.max(1, Math.round(Math.max(w, h) / 80)), sw = Math.ceil(w / f), sh = Math.ceil(h / f), small = new Float32Array(sw * sh).fill(lightSubject ? 255 : 0);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = ((y / f) | 0) * sw + ((x / f) | 0); small[i] = lightSubject ? Math.min(small[i], g[y * w + x]) : Math.max(small[i], g[y * w + x]); }
  const r = Math.max(2, Math.round(Math.max(sw, sh) / 5)), bgS = boxBlur(extremum(small, sw, sh, r, !lightSubject), sw, sh, r, 2), out = new Float32Array(g.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) / f - 0.5)), fy = Math.min(sh - 1, Math.max(0, (y + 0.5) / f - 0.5)), x0 = fx | 0, y0 = fy | 0, x1 = Math.min(sw - 1, x0 + 1), y1 = Math.min(sh - 1, y0 + 1), tx = fx - x0, ty = fy - y0;
    const bg = (bgS[y0 * sw + x0] * (1 - tx) + bgS[y0 * sw + x1] * tx) * (1 - ty) + (bgS[y1 * sw + x0] * (1 - tx) + bgS[y1 * sw + x1] * tx) * ty, i = y * w + x;
    out[i] = lightSubject ? 255 - Math.min(255, ((255 - g[i]) / Math.max(1, 255 - bg)) * 255) : Math.min(255, (g[i] / Math.max(1, bg)) * 255);
  }
  return out;
}
/** Otsu's threshold for a greyscale image. */
export function otsu(g: Float32Array): number {
  const hist = new Float64Array(256); for (const v of g) hist[Math.max(0, Math.min(255, v | 0))]++;
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sB = 0, wB = 0, best = 0, th = 128; const n = g.length;
  for (let t = 0; t < 256; t++) { wB += hist[t]; if (!wB) continue; const wF = n - wB; if (!wF) break; sB += t * hist[t]; const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF); if (v > best) { best = v; th = t; } }
  return th + 0.5;
}

// ---------- colour reduction ----------
/** k-means colour reduction (deterministic seeding). Returns palette and a label per pixel. */
export function quantise(img: Img, k: number): { palette: [number, number, number][]; labels: Uint8Array } {
  const n = img.w * img.h, d = img.data, step = Math.max(1, Math.floor(n / 20000));
  const px = (i: number): [number, number, number] => { const a = d[i * 4 + 3] / 255; return [d[i * 4] * a + 255 * (1 - a), d[i * 4 + 1] * a + 255 * (1 - a), d[i * 4 + 2] * a + 255 * (1 - a)]; };
  const samples: [number, number, number][] = []; for (let i = 0; i < n; i += step) samples.push(px(i));
  // farthest-point seeding from the mean (repeatable)
  const mean = samples.reduce((m, s) => [m[0] + s[0] / samples.length, m[1] + s[1] / samples.length, m[2] + s[2] / samples.length], [0, 0, 0]);
  const d2 = (a: number[], b: number[]) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  const C: [number, number, number][] = [];
  let far = samples[0]; for (const s of samples) if (d2(s, mean) > d2(far, mean)) far = s; C.push([...far]);
  while (C.length < k) { let best = samples[0], bd = -1; for (const s of samples) { const m = Math.min(...C.map(c => d2(s, c))); if (m > bd) { bd = m; best = s; } } if (bd <= 0) break; C.push([...best]); }
  for (let it = 0; it < 12; it++) {
    const acc = C.map(() => [0, 0, 0, 0]);
    for (const s of samples) { let bi = 0, bd = Infinity; C.forEach((c, j) => { const v = d2(s, c); if (v < bd) { bd = v; bi = j; } }); const a = acc[bi]; a[0] += s[0]; a[1] += s[1]; a[2] += s[2]; a[3]++; }
    acc.forEach((a, j) => { if (a[3]) C[j] = [a[0] / a[3], a[1] / a[3], a[2] / a[3]]; });
  }
  const labels = new Uint8Array(n);
  for (let i = 0; i < n; i++) { const s = px(i); let bi = 0, bd = Infinity; C.forEach((c, j) => { const v = d2(s, c); if (v < bd) { bd = v; bi = j; } }); labels[i] = bi; }
  return { palette: C.map(c => [Math.round(c[0]), Math.round(c[1]), Math.round(c[2])] as [number, number, number]), labels };
}
/** 3×3 majority filter on a label image (removes isolated specks of colour). */
function modeFilter(lab: Uint8Array, w: number, h: number, k: number): Uint8Array {
  const out = new Uint8Array(lab.length), cnt = new Uint16Array(k);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    cnt.fill(0);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = Math.min(w - 1, Math.max(0, x + dx)), yy = Math.min(h - 1, Math.max(0, y + dy)); cnt[lab[yy * w + xx]]++; }
    let bi = lab[y * w + x]; for (let j = 0; j < k; j++) if (cnt[j] > cnt[bi]) bi = j; out[y * w + x] = bi;
  }
  return out;
}
/** Labels covering a good share (≥ 20 %) of the image border — the likely background (may be split in two by a gradient). */
function borderLabels(lab: Uint8Array, w: number, h: number, k: number): number[] {
  const c = new Uint32Array(k); let t = 0;
  for (let x = 0; x < w; x++) { c[lab[x]]++; c[lab[(h - 1) * w + x]]++; t += 2; }
  for (let y = 0; y < h; y++) { c[lab[y * w]]++; c[lab[y * w + w - 1]]++; t += 2; }
  const out: number[] = []; let bi = 0; for (let j = 0; j < k; j++) { if (c[j] > c[bi]) bi = j; if (c[j] >= 0.2 * t) out.push(j); }
  return out.length ? out : [bi];
}

// ---------- mask → loops ----------
/** Fill enclosed background areas (holes) of a mask. */
export function fillHoles(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = Uint8Array.from(mask), seen = new Uint8Array(mask.length), st: number[] = [];
  const push = (i: number) => { if (!seen[i] && !mask[i]) { seen[i] = 1; st.push(i); } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); } for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (st.length) { const i = st.pop()!, x = i % w, y = (i / w) | 0; if (x > 0) push(i - 1); if (x < w - 1) push(i + 1); if (y > 0) push(i - w); if (y < h - 1) push(i + w); }
  for (let i = 0; i < mask.length; i++) if (!mask[i] && !seen[i]) out[i] = 1;
  return out;
}
/**
 * Boundary loops of a binary mask, along pixel edges. Inside pixels are kept
 * on the right of travel (screen coordinates); at diagonal "saddle" corners the
 * loop turns right, so pixels touching only at a corner stay separate.
 */
export function traceMask(mask: Uint8Array, w: number, h: number): { x: number; y: number }[][] {
  const W = w + 1, V = W * (h + 1), out0 = new Int8Array(V).fill(-1), out1 = new Int8Array(V).fill(-1);
  const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];         // 0 right, 1 down, 2 left, 3 up
  const add = (x: number, y: number, dir: number) => { const v = y * W + x; if (out0[v] < 0) out0[v] = dir; else out1[v] = dir; };
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!mask[y * w + x]) continue;
    if (!at(x, y - 1)) add(x, y, 0);          // top edge, left → right
    if (!at(x + 1, y)) add(x + 1, y, 1);      // right edge, down
    if (!at(x, y + 1)) add(x + 1, y + 1, 2);  // bottom edge, right → left
    if (!at(x - 1, y)) add(x, y + 1, 3);      // left edge, up
  }
  const loops: { x: number; y: number }[][] = [], used0 = new Uint8Array(V), used1 = new Uint8Array(V);
  const isUsed = (v: number, d: number) => (out0[v] === d && used0[v]) || (out1[v] === d && used1[v]);
  const use = (v: number, d: number) => { if (out0[v] === d) used0[v] = 1; else used1[v] = 1; };
  for (let v0 = 0; v0 < V; v0++) {
    for (const d0 of [out0[v0], out1[v0]]) {
      if (d0 < 0 || isUsed(v0, d0)) continue;
      const pts: { x: number; y: number }[] = [];
      let v = v0, dir = d0;
      while (!isUsed(v, dir)) {
        use(v, dir); pts.push({ x: v % W, y: (v / W) | 0 });
        const nv = v + DX[dir] + DY[dir] * W, a = out0[nv], b = out1[nv];
        if (a < 0) break;
        dir = b < 0 ? a : (a === (dir + 1) % 4 ? a : b === (dir + 1) % 4 ? b : a);
        v = nv;
      }
      if (pts.length >= 4) loops.push(pts);
    }
  }
  return loops;
}

// ---------- loop clean-up ----------
export const loopArea = (p: { x: number; y: number }[]) => { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[i], r = p[(i + 1) % p.length]; a += q.x * r.y - r.x * q.y; } return a / 2; };
const midpoints = (p: { x: number; y: number }[]) => p.map((q, i) => { const r = p[(i + 1) % p.length]; return { x: (q.x + r.x) / 2, y: (q.y + r.y) / 2 }; });
export function chaikin(p: { x: number; y: number }[], passes: number) {
  let cur = p;
  for (let k = 0; k < passes; k++) { const o: { x: number; y: number }[] = []; cur.forEach((q, i) => { const r = cur[(i + 1) % cur.length]; o.push({ x: .75 * q.x + .25 * r.x, y: .75 * q.y + .25 * r.y }, { x: .25 * q.x + .75 * r.x, y: .25 * q.y + .75 * r.y }); }); cur = o; }
  return cur;
}
function dpOpen(p: { x: number; y: number }[], tol: number): { x: number; y: number }[] {
  if (p.length < 3) return p;
  const keep = new Uint8Array(p.length); keep[0] = keep[p.length - 1] = 1;
  const st: [number, number][] = [[0, p.length - 1]];
  while (st.length) {
    const [a, b] = st.pop()!, A = p[a], B = p[b], dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy) || 1;
    let bi = -1, bd = tol;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((p[i].x - A.x) * dy - (p[i].y - A.y) * dx) / L; if (d > bd) { bd = d; bi = i; } }
    if (bi >= 0) { keep[bi] = 1; st.push([a, bi], [bi, b]); }
  }
  return p.filter((_, i) => keep[i]);
}
/** Douglas–Peucker for a closed loop. */
export function simplifyClosed(p: { x: number; y: number }[], tol: number) {
  if (p.length < 4) return p;
  let far = 0, fd = -1; for (let i = 1; i < p.length; i++) { const d = (p[i].x - p[0].x) ** 2 + (p[i].y - p[0].y) ** 2; if (d > fd) { fd = d; far = i; } }
  const a = dpOpen(p.slice(0, far + 1), tol), b = dpOpen(p.slice(far).concat([p[0]]), tol);
  return a.concat(b.slice(1, -1));
}

// ---------- the whole pipeline ----------
export function trace(img: Img, o: TraceOpts): TraceResult {
  const { w, h } = img, n = w * h;
  const masks: { mask: Uint8Array; colour: number }[] = [];
  let palette: [number, number, number][] = [], background = -1, backgrounds: number[] = [], threshold = 0;
  const E = o.erase;
  /** brush edits on a binary mask: fills first, then fill holes, then erasing */
  const edit = (m: Uint8Array, holes: boolean) => {
    if (E) for (let i = 0; i < n; i++) if (E[i] >= 2) m[i] = 1;
    if (holes) m = fillHoles(m, w, h);
    if (E) for (let i = 0; i < n; i++) if (E[i] === 1) m[i] = 0;
    return m;
  };
  let network: { x: number; y: number }[][] | null = null, netClosed: boolean[] = [];
  if (o.mode === 'silhouette') {
    let g = toGrey(img);
    if (o.clean >= 1) g = median3(g, w, h);
    if (o.clean >= 2) g = boxBlur(g, w, h, o.clean - 1, 2);
    if (o.flatten) g = flattenBackground(g, w, h, o.invert);
    threshold = o.threshold === 'auto' ? otsu(g) : o.threshold;
    const m = new Uint8Array(n); for (let i = 0; i < n; i++) m[i] = (o.invert ? g[i] > threshold : g[i] < threshold) ? 1 : 0;
    masks.push({ mask: edit(m, o.fillHoles), colour: 0 });
  } else {
    const k = Math.max(2, Math.min(12, Math.round(o.colours)));
    let src = img;
    if (o.clean >= 2 || o.flatten) { // blur each channel a little, and/or level the background, before reducing colours
      const ch = [0, 1, 2].map(c => {
        let a: Float32Array = new Float32Array(n); for (let i = 0; i < n; i++) { const al = img.data[i * 4 + 3] / 255; a[i] = img.data[i * 4 + c] * al + 255 * (1 - al); }
        if (o.clean >= 2) a = boxBlur(a, w, h, o.clean - 1, 1);
        return o.flatten ? flattenBackground(a, w, h, o.invert) : a;
      });
      const d = new Uint8ClampedArray(img.data); for (let i = 0; i < n; i++) { for (let c = 0; c < 3; c++) d[i * 4 + c] = ch[c][i]; d[i * 4 + 3] = 255; }
      src = { w, h, data: d };
    }
    const q = quantise(src, k); palette = q.palette;
    let lab = q.labels; if (o.clean >= 1) lab = modeFilter(lab, w, h, palette.length);
    backgrounds = borderLabels(lab, w, h, palette.length); background = backgrounds[0];
    const keep = palette.map((_, j) => o.keep?.[j] ?? !backgrounds.includes(j));
    if (o.merge) { const m = new Uint8Array(n); for (let i = 0; i < n; i++) m[i] = keep[lab[i]] ? 1 : 0; masks.push({ mask: edit(m, o.fillHoles), colour: -1 }); }
    else {
      // one network of boundaries: each edge between two colours is traced once (no doubled lines)
      const BG = 255, L = new Uint8Array(n);
      for (let i = 0; i < n; i++) { const e = E ? E[i] : 0; L[i] = e === 1 ? BG : e >= 2 ? e - 2 : keep[lab[i]] ? lab[i] : BG; }
      mergeSpecks(L, w, h, Math.max(1, o.speckPx));
      for (let i = 0; i < n; i++) if (L[i] !== BG) { const m = new Uint8Array(1); m[0] = 1; masks.push({ mask: m, colour: L[i] }); break; }
      const net = traceNetwork(L, w, h, BG); network = net.chains; netClosed = net.closed;
      lastLabels = L;
    }
  }
  const loops: Loop[] = []; let points = 0, found = 0, largest = 0, on = 0;
  if (network) {
    for (let i = 0; i < n; i++) if (lastLabels![i] !== 255) on++;
    network.forEach((raw, ci) => {
      found++; largest = Math.max(largest, raw.length * raw.length);
      const closed = netClosed[ci];
      let p = closed ? midpoints(raw) : openMidpoints(raw);
      if (o.smooth > 0) p = closed ? chaikin(p, Math.round(o.smooth)) : chaikinOpen(p, Math.round(o.smooth));
      p = closed ? simplifyClosed(p, Math.max(0.05, o.tolPx)) : dpOpen(p, Math.max(0.05, o.tolPx));
      if (p.length < (closed ? 3 : 2)) return;
      loops.push({ pts: p, area: closed ? loopArea(p) : 0, colour: -1, closed }); points += p.length;
    });
    const keptColours = palette.filter((_, j) => o.keep?.[j] ?? !backgrounds.includes(j)).length;
    return { loops, palette, background, backgrounds, threshold, points, diag: { found, largestPx: Infinity, coverage: on / n, masks: 1, keptColours } };
  }
  for (const { mask } of masks) for (let i = 0; i < n; i++) on += mask[i];
  for (const { mask, colour } of masks) for (const raw of traceMask(mask, w, h)) {
    const area = loopArea(raw); found++; largest = Math.max(largest, Math.abs(area));
    if (Math.abs(area) < Math.max(1, o.speckPx)) continue;
    let p = midpoints(raw);
    if (o.smooth > 0) p = chaikin(p, Math.round(o.smooth));
    p = simplifyClosed(p, Math.max(0.05, o.tolPx));
    if (p.length < 3) continue;
    loops.push({ pts: p, area, colour }); points += p.length;
  }
  const keptColours = o.mode === 'colours' ? palette.filter((_, j) => o.keep?.[j] ?? !backgrounds.includes(j)).length : 1;
  return { loops, palette, background, backgrounds, threshold, points, diag: { found, largestPx: largest, coverage: masks.length ? on / (n * (o.merge || o.mode === 'silhouette' ? 1 : masks.length)) : 0, masks: masks.length, keptColours } };
}

/** Plain-English reason when a trace finds nothing (null if outlines were found). */
export function whyEmpty(r: TraceResult, o: TraceOpts): string | null {
  if (r.loops.length) return null;
  const d = r.diag;
  if (o.mode === 'colours' && d.keptColours === 0) return 'All colours are dropped — click a colour swatch to keep it.';
  if (o.erase && o.erase.every(v => v === 1)) return 'The whole picture has been erased — press Clear brush.';
  if (d.coverage < 0.0005) return o.mode === 'silhouette' ? (o.invert ? 'Nothing is lighter than the threshold — move Threshold left, or untick "Light shape on dark".' : 'Nothing is darker than the threshold — move Threshold right, or tick "Light shape on dark".') : 'The colours you kept are not in the picture.';
  if (d.coverage > 0.9995) return 'The whole picture counts as the shape — move Threshold the other way, or change "Light shape on dark".';
  if (d.found && d.largestPx < o.speckPx) return `All ${d.found} pieces are smaller than "Ignore specks" — lower it.`;
  return 'Nothing found — press Reset to go back to the starting settings.';
}


let lastLabels: Uint8Array | null = null;
/** Colour label per pixel from the last Colours trace (255 = background / dropped). */
export const lastLabelMap = () => lastLabels;
const openMidpoints = (p: { x: number; y: number }[]) => { if (p.length < 3) return p; const o = [p[0]]; for (let i = 0; i < p.length - 1; i++) o.push({ x: (p[i].x + p[i + 1].x) / 2, y: (p[i].y + p[i + 1].y) / 2 }); o.push(p[p.length - 1]); return o; };
/** Chaikin smoothing for an open line, keeping both ends fixed (so junctions stay joined). */
export function chaikinOpen(p: { x: number; y: number }[], passes: number) {
  let cur = p;
  for (let k = 0; k < passes && cur.length > 2; k++) {
    const o = [cur[0]];
    for (let i = 0; i < cur.length - 1; i++) { const q = cur[i], r = cur[i + 1]; if (i > 0) o.push({ x: .75 * q.x + .25 * r.x, y: .75 * q.y + .25 * r.y }); if (i < cur.length - 2) o.push({ x: .25 * q.x + .75 * r.x, y: .25 * q.y + .75 * r.y }); }
    o.push(cur[cur.length - 1]); cur = o;
  }
  return cur;
}

/** Merge connected areas smaller than minArea into the neighbouring label they touch most (removes colour specks). */
export function mergeSpecks(L: Uint8Array, w: number, h: number, minArea: number) {
  const n = w * h, comp = new Int32Array(n).fill(-1), st: number[] = [];
  let c = 0;
  for (let s = 0; s < n; s++) {
    if (comp[s] >= 0) continue;
    const lab = L[s], px: number[] = []; comp[s] = c; st.push(s);
    while (st.length) { const i = st.pop()!; px.push(i); const x = i % w, y = (i / w) | 0;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) if (j >= 0 && comp[j] < 0 && L[j] === lab) { comp[j] = c; st.push(j); } }
    if (px.length < minArea) {
      const count = new Map<number, number>();
      for (const i of px) { const x = i % w, y = (i / w) | 0; for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) if (j >= 0 && comp[j] !== c) count.set(L[j], (count.get(L[j]) || 0) + 1); }
      let best = -1, bc = -1; for (const [k, v] of count) if (v > bc) { bc = v; best = k; }
      if (best >= 0) for (const i of px) L[i] = best;
    }
    c++;
  }
}

/**
 * Boundaries of a label image as a network: every edge between two different
 * labels is traced exactly once. Lines run between junctions (where three or
 * more areas meet) or form closed loops.
 */
export function traceNetwork(L: Uint8Array, w: number, h: number, BG = 255): { chains: { x: number; y: number }[][]; closed: boolean[] } {
  const W = w + 1, lab = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h) ? BG : L[y * w + x];
  // edge bitmaps: horizontal edge (x,y)→(x+1,y) separates (x,y-1) and (x,y); vertical edge (x,y)→(x,y+1) separates (x-1,y) and (x,y)
  const hE = new Uint8Array(W * (h + 1)), vE = new Uint8Array(W * (h + 1)), deg = new Uint8Array(W * (h + 1));
  for (let y = 0; y <= h; y++) for (let x = 0; x < w; x++) if (lab(x, y - 1) !== lab(x, y)) { hE[y * W + x] = 1; deg[y * W + x]++; deg[y * W + x + 1]++; }
  for (let y = 0; y < h; y++) for (let x = 0; x <= w; x++) if (lab(x - 1, y) !== lab(x, y)) { vE[y * W + x] = 1; deg[y * W + x]++; deg[(y + 1) * W + x]++; }
  const chains: { x: number; y: number }[][] = [], closed: boolean[] = [];
  /** unused edge leaving v in direction d (0 right, 1 down, 2 left, 3 up)? */
  const has = (v: number, d: number) => { const x = v % W, y = (v / W) | 0; return d === 0 ? x < w && hE[v] === 1 : d === 2 ? x > 0 && hE[v - 1] === 1 : d === 1 ? y < h && vE[v] === 1 : y > 0 && vE[v - W] === 1; };
  const take = (v: number, d: number) => { if (d === 0) hE[v] = 2; else if (d === 2) hE[v - 1] = 2; else if (d === 1) vE[v] = 2; else vE[v - W] = 2; };
  const step = [1, W, -1, -W];
  const walk = (v0: number, d0: number) => {
    const pts = [{ x: v0 % W, y: (v0 / W) | 0 }]; let v = v0, d = d0;
    for (;;) {
      take(v, d); v += step[d]; pts.push({ x: v % W, y: (v / W) | 0 });
      if (v === v0 || deg[v] !== 2) break;
      let nd = -1; for (let k = 0; k < 4; k++) if (has(v, k)) { nd = k; break; }
      if (nd < 0) break; d = nd;
    }
    return { pts, loop: v === v0 && deg[v0] === 2 };
  };
  for (let v = 0; v < W * (h + 1); v++) if (deg[v] && deg[v] !== 2) for (let d = 0; d < 4; d++) while (has(v, d)) { const r = walk(v, d); chains.push(r.pts); closed.push(false); }
  for (let v = 0; v < W * (h + 1); v++) for (let d = 0; d < 4; d++) while (has(v, d)) { const r = walk(v, d); if (r.loop) r.pts.pop(); chains.push(r.pts); closed.push(r.loop); }
  return { chains, closed };
}
