// The benchmark's camera path, shared by every engine's page: the Origin
// game imports it, and so does the three.js page (three/src/main.ts). Plain
// numbers and arithmetic only, so both evaluate the same path.
//
// It starts on the showcase's cover shot behind the wanderer, walks down the
// cliff path towards the lighthouse, rises over the path to the cottage,
// swings out over the sea past the stacks to look back at the headland and
// the low sun, comes round behind the wanderer and ends on the cover shot
// again (the frame every engine's screenshot shows). Heights are the
// terrain's (assets/terrain/coast-height.png) plus the eye's.

/** Seconds the path lasts. */
export const PATH_SECONDS = 20;

/** [seconds, eye x, y, z, target x, y, z] */
export const KEYS: readonly (readonly [number, number, number, number, number, number, number])[] = [
  // The cover: src/layout.ts CAMERA on the ground at 18.98 m.
  [0, 0.2, 20.88, 3.2, 2.3, 17.28, -75],
  [4, -0.6, 20.1, -12, 10, 30, -82],
  [8, 6, 27, -38, 14, 40, -82],
  [12, 62, 22, -62, 14, 36, -84],
  [16, -6, 25.5, 10, -1.45, 20.5, 0.1],
  [20, 0.2, 20.88, 3.2, 2.3, 17.28, -75],
];

const catmull = (p0: number, p1: number, p2: number, p3: number, t: number): number => {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
};

/** The eye and the point it looks at, `seconds` into the path (clamped to it): a Catmull-Rom spline through the keys. */
export function cameraAt(seconds: number): { eye: [number, number, number]; target: [number, number, number] } {
  const s = Math.min(PATH_SECONDS, Math.max(0, seconds));
  let i = 0;
  while (i < KEYS.length - 2 && s > KEYS[i + 1]![0]) i++;
  const k0 = KEYS[Math.max(0, i - 1)]!, k1 = KEYS[i]!, k2 = KEYS[i + 1]!, k3 = KEYS[Math.min(KEYS.length - 1, i + 2)]!;
  const t = (s - k1[0]) / (k2[0] - k1[0]);
  const v = (j: number) => catmull(k0[j]!, k1[j]!, k2[j]!, k3[j]!, t);
  return { eye: [v(1), v(2), v(3)], target: [v(4), v(5), v(6)] };
}
