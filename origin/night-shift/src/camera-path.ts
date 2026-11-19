// The benchmark's camera path, shared by every engine's page: the Origin
// game imports it, and so does the three.js page (three/src/main.ts). Plain
// numbers and arithmetic only, so both evaluate the same path.
//
// It starts on the showcase's cover shot, walks down the alley past the
// stall and through the walkers, rises under the signs to look up at the
// towers, swings round behind the courier and the bike, and ends on the
// cover shot again (the frame every engine's screenshot shows).

/** Seconds the path lasts. */
export const PATH_SECONDS = 20;

/** [seconds, eye x, y, z, target x, y, z] */
export const KEYS: readonly (readonly [number, number, number, number, number, number, number])[] = [
  [0, 0, 0.7, 7, 0, 5.2, -13],
  [4, -1.2, 1.4, 3, 0.8, 2.6, -15],
  [8, 1.2, 1.9, -4, -0.8, 3, -24],
  [12, 0, 3.2, -12, 0, 12, -90],
  [16, 3.6, 1.7, 9, 1.4, 1.1, 4],
  [20, 0, 0.7, 7, 0, 5.2, -13],
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
