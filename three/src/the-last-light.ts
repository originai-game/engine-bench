// The Last Light in three.js (WebGPURenderer), rebuilt from the Origin game's
// own code (origin/the-last-light/src: coast.ts, lighthouse.ts, sky.ts,
// wanderer.ts, climate.ts and looks/the-last-light.ogt over
// cinematic-realism, mood warm) with the same numbers, and the same models,
// textures and ground, exported once as glTF, KTX2 and raw samples
// (scripts/export-content.sh). The climate is fixed where the game starts:
// clear, summer, sunset (17.9 h).
//
// What three.js ships (the core and its official addons) is used where it
// has the feature. Where it has none, the page draws it by hand and the
// README's feature table says so: the terrain's layered material, the grass
// field, the five scatter layers' placement, the sea's surface, the height
// fog and the wanderer's two-bone arm IK. What three.js cannot draw at all
// is listed there, not imitated.
import * as THREE from "three/webgpu";
import {
  Fn, If, abs, builtinAOContext, clamp, color, cos, dot, exp, float, floor, fract, hash, instanceIndex, int, ivec2, length, max, min, mix,
  mrt, mx_noise_float, normalView, positionGeometry, normalize, normalWorld, packNormalToRGB, pass, positionLocal, positionView, positionWorld, positionWorldDirection, pow,
  fog, renderOutput, sample, saturation, screenUV, sin, smoothstep, sqrt, texture, textureLoad, transformNormalToView, uniform, uniformArray, unpackRGBToNormal, uv,
  vec2, vec3, vec4, cameraPosition, luminance, step, varying, uint, screenCoordinate, convertToTexture, Loop, screenSize, materialColor, vertexColor,
} from "three/tsl";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { CSMShadowNode } from "three/addons/csm/CSMShadowNode.js";
import { SkyMesh } from "three/addons/objects/SkyMesh.js";
import { ao } from "three/addons/tsl/display/GTAONode.js";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { chromaticAberration } from "three/addons/tsl/display/ChromaticAberrationNode.js";
import { film } from "three/addons/tsl/display/FilmNode.js";
import { gaussianBlur } from "three/addons/tsl/display/GaussianBlurNode.js";
import { bayer16 } from "three/addons/tsl/math/Bayer.js";
import { cameraAt, PATH_SECONDS } from "../../origin/the-last-light/src/camera-path.ts";
import { CAMERA, COTTAGE, HEIGHT_RANGE, LIGHTHOUSE, RUIN, SAMPLES, SIZE, WANDERER } from "../../origin/the-last-light/src/layout.ts";

const lin = (r: number, g: number, b: number) => new THREE.Color().setRGB(r, g, b, THREE.LinearSRGBColorSpace);
const UP = new THREE.Vector3(0, 1, 0);

// --- what Origin's og.DayNight and og.PhysicalSky make of 17.9 h ------------
// (azimuth 333, tilt 35, haze 1, airDensity 1.1; the probe's
// `get og.DayNight.toSun / lightColor / lightIntensity` at the cover): the
// sun 1.2 degrees over the sea, its light reddened by the air.
const TO_SUN = new THREE.Vector3(0.46721309, 0.0214429, -0.88388467).normalize();
const SUN_LIGHT = lin(2.99665594 * 0.22769418, 0.49094456 * 0.22769418, 0.01195296 * 0.22769418);
// The look's exposure: og.RenderSettings.autoExposure (cinematic-realism)
// meters the frame and adapts; three.js has no exposure meter, so the page
// holds one exposure, set so the cover (0.5 s into the path) is as bright as
// Origin draws it (README): elsewhere on the path the two differ.
const EXPOSURE = 2.0;

// --- renderer, scene, camera ---------------------------------------------------
const renderer = new THREE.WebGPURenderer({ antialias: false });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.AgXToneMapping; // cinematic-realism: toneMapping agx
renderer.toneMappingExposure = EXPOSURE;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);
await renderer.init();

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(CAMERA.fov, window.innerWidth / window.innerHeight, 0.1, 6000);
const placeCamera = (seconds: number) => {
  const { eye, target } = cameraAt(seconds);
  camera.position.set(...eye);
  camera.lookAt(...target);
};
placeCamera(0);

// --- the sky: three.js's physical sky (Preetham) with its cloud layer -------------
const sky = new SkyMesh();
sky.scale.setScalar(5000);
sky.sunPosition.value.copy(TO_SUN);
sky.turbidity.value = 2; // og.PhysicalSky.haze 1: Earth's clear-day aerosols
sky.rayleigh.value = 1.1 * 1.6; // airDensity 1.1
sky.mieCoefficient.value = 0.005;
sky.mieDirectionalG.value = 0.8;
sky.cloudCoverage.value = 0.46; // og.Clouds.coverage (clear)
sky.cloudDensity.value = 0.5;
sky.cloudElevation.value = 0.6;
// The sun disc at Origin's radiance (SkyLook::PHYSICAL_SUN_INTENSITY 360 times the
// air's transmittance, about (82, 13, 0.3) here): SkyMesh draws it about 20 times that.
sky.showSunDisc.value = 0.05;
scene.add(sky);
// The image-based light from the same sky (environmentIntensity 0.55).
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  const skyScene = new THREE.Scene();
  const skyCopy = new SkyMesh();
  skyCopy.scale.setScalar(5000);
  for (const k of ["turbidity", "rayleigh", "mieCoefficient", "mieDirectionalG", "cloudCoverage", "cloudDensity", "cloudElevation"] as const) skyCopy[k].value = sky[k].value;
  skyCopy.sunPosition.value.copy(TO_SUN);
  skyCopy.showSunDisc.value = 0;
  skyScene.add(skyCopy);
  scene.environment = pmrem.fromScene(skyScene, 0, 0.1, 6000).texture;
  // RenderSettings.environmentIntensity 0.55, times the eye's adaptation to
  // the shade Origin's day-night cycle gives the sky's light at sunset
  // (og-render DayNightLook::with_atmosphere: 1 + 3 (1 - ramp(-0.1, 0.15,
  // sun.y)) with no moon up, 2.56 at sun.y 0.021).
  const t = Math.min(1, Math.max(0, (TO_SUN.y + 0.1) / 0.25));
  scene.environmentIntensity = 0.55 * (1 + 3 * (1 - t * t * (3 - 2 * t)));
}

// The sun: og.DirectionalLight castShadow, shadowDistance 160, three cascades.
const sun = new THREE.DirectionalLight(SUN_LIGHT, 1);
sun.position.copy(TO_SUN).multiplyScalar(400);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
// The sun 1.2 degrees over the sea lights the land at a grazing angle: a
// depth bias and a normal offset keep the ground from shadowing itself
// (Origin's shadows apply theirs inside the renderer).
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.08;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 900;
Object.assign(sun.shadow.camera, { left: -200, right: 200, top: 200, bottom: -200 });
sun.shadow.shadowNode = new CSMShadowNode(sun, { cascades: 3, maxFar: 160, mode: "practical" });
scene.add(sun, sun.target);

// bench-feature terrain
// --- the ground: assets/terrain/coast.ogt, 480 m, 1025 samples a side ------------
const N = SAMPLES - 1;
const [heightBytes, controlBytes] = await Promise.all(
  ["coast-height.r16", "coast-control.rgba"].map((f) => fetch(`./content/terrain/${f}`).then((r) => r.arrayBuffer())),
);
const height16 = new Uint16Array(heightBytes!);
const control = new Uint8Array(controlBytes!);
const heights = new Float32Array(SAMPLES * SAMPLES);
for (let i = 0; i < heights.length; i++) heights[i] = HEIGHT_RANGE[0] + (height16[i]! / 65535) * (HEIGHT_RANGE[1] - HEIGHT_RANGE[0]);
/** The sample grid's coordinates of world (x, z). */
const gridOf = (x: number, z: number) => [(x / SIZE + 0.5) * N, (z / SIZE + 0.5) * N] as const;
const bilinear = (data: Float32Array | Uint8Array, stride: number, channel: number, x: number, z: number) => {
  const [gx, gz] = gridOf(x, z);
  const cx = Math.min(N, Math.max(0, gx)), cz = Math.min(N, Math.max(0, gz));
  const x0 = Math.min(N - 1, Math.floor(cx)), z0 = Math.min(N - 1, Math.floor(cz)), fx = cx - x0, fz = cz - z0;
  const at = (i: number, j: number) => data[((z0 + j) * SAMPLES + x0 + i) * stride + channel]!;
  return (at(0, 0) * (1 - fx) + at(1, 0) * fx) * (1 - fz) + (at(0, 1) * (1 - fx) + at(1, 1) * fx) * fz;
};
const heightAt = (x: number, z: number) => bilinear(heights, 1, 0, x, z);
/**
 * The layers' weights (turf, cliff, path, shore) as the terrain draws them
 * at world (x, z), which is where og.Grass and og.TerrainScatter grow: the
 * control map's, normalised, then with coast.ogt's height blend each layer
 * kept only within 0.15 of the strongest (og-render's `drawn_weights`, every
 * layer's heightContrast 0), normalised again.
 */
const weightsAt = (x: number, z: number) => {
  const w = [0, 1, 2, 3].map((c) => bilinear(control, 4, c, x, z) / 255);
  const sum = w.reduce((a, b) => a + b, 0) || 1;
  const raw = w.map((v) => v / sum);
  const top = Math.max(...raw);
  const drawn = raw.map((v) => (v > 1e-3 ? Math.max(0, v - (top - 0.15)) : 0));
  const total = drawn.reduce((a, b) => a + b, 0);
  return total < 1e-4 ? raw : drawn.map((v) => v / total);
};

// The ground's samples on the GPU, for the grass and the sea.
const heightTexture = new THREE.DataTexture(heights, SAMPLES, SAMPLES, THREE.RedFormat, THREE.FloatType);
heightTexture.needsUpdate = true;
const controlTexture = new THREE.DataTexture(control, SAMPLES, SAMPLES, THREE.RGBAFormat, THREE.UnsignedByteType);
controlTexture.needsUpdate = true;
/** Bilinear height at world xz, from the samples (float textures need not filter). */
const groundHeight = Fn(([xz]: [any]) => {
  const g = xz.div(SIZE).add(0.5).mul(N).clamp(0, N - 0.001).toVar();
  const i = floor(g).toVar(), f = g.sub(i).toVar();
  const at = (dx: number, dz: number) => textureLoad(heightTexture, ivec2(int(i.x).add(dx), int(i.y).add(dz))).r;
  return mix(mix(at(0, 0), at(1, 0), f.x), mix(at(0, 1), at(1, 1), f.x), f.y);
});
const groundWeights = Fn(([xz]: [any]) => {
  const g = xz.div(SIZE).add(0.5).mul(N).clamp(0, N).round();
  const w = textureLoad(controlTexture, ivec2(int(g.x), int(g.y)));
  return w.div(max(w.r.add(w.g).add(w.b).add(w.a), 1e-4));
});
/** weightsAt's drawn weights on the GPU, for the blades. */
const drawnWeights = Fn(([xz]: [any]) => {
  const w = groundWeights(xz).toVar();
  const top = max(max(w.x, w.y), max(w.z, w.w));
  const d = max(w.sub(top.sub(0.15)), vec4(0)).mul(step(1e-3, w)).toVar();
  const total = d.x.add(d.y).add(d.z).add(d.w);
  return total.lessThan(1e-4).select(w, d.div(max(total, 1e-4)));
});

const ktx2 = new KTX2Loader().setTranscoderPath("./basis/").detectSupport(renderer);
const gltfLoader = new GLTFLoader().setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);
const groundTexture = (name: string, srgb: boolean) => ktx2.loadAsync(`./content/terrain/${name}.ktx2`).then((t) => {
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
});
const [turfAlbedo, turfNormal, rockAlbedo, rockNormal, pathAlbedo, pathNormal] = await Promise.all([
  groundTexture("aerial_grass_rock_diff_1k", true), groundTexture("aerial_grass_rock_nor_gl_1k", false),
  groundTexture("rock_face_03_grey_1k", true), groundTexture("rock_face_03_nor_gl_1k", false),
  groundTexture("forest_ground_04_diff_1k", true), groundTexture("forest_ground_04_nor_gl_1k", false),
]);

// The season's grass and turf (climate.ts YEAR, summer).
const GRASS = {
  density: 700, distance: 120, height: 0.55, heightVariation: 0.4, width: 0.012, curve: 0.5, lean: 0.3, clumpSize: 1.2, clumpLean: 0.4,
  base: lin(0.04, 0.085, 0.024), tip: lin(0.235, 0.39, 0.11), dry: lin(0.45, 0.38, 0.17), dryness: 0.15, colorVariation: 0.3,
  translucency: 0.6, roughness: 0.6, sway: 1,
};
const WIND = { x: -0.9 / Math.hypot(0.9, 0.45), z: 0.45 / Math.hypot(0.9, 0.45), speed: 8 };
const pathTime = uniform(0);
// The gusts' share (0 to 1), patches 14 m across travelling downwind.
const windGust = (xz: any) => mx_noise_float(xz.add(vec2(WIND.x, WIND.z).mul(pathTime.mul(WIND.speed * -0.6))).mul(1 / 14)).mul(0.5).add(0.5);

// The layered ground material (coast.ogt's four layers): weights from the
// control map, sharpened by each layer's height (heightBlend 0.5); turf and
// the path projected from above, both rocks triplanar; each layer's tile,
// tint, roughness, anti-tiling and macro variation; and under the grass and
// past it the field's own colour (og.Grass farTint).
{
  const xz = positionWorld.xz;
  const nGeom = normalWorld;
  const macro = (amount: number) => mix(float(1), mx_noise_float(xz.mul(1 / 36)).mul(0.5).add(0.85), amount);
  const antiTiled = (map: THREE.Texture, at: any, amount: number) => {
    const a = texture(map, at);
    if (amount <= 0) return a;
    const turned = vec2(at.x.mul(0.8).sub(at.y.mul(0.6)), at.x.mul(0.6).add(at.y.mul(0.8))).mul(0.73).add(0.37);
    return mix(a, texture(map, turned), smoothstep(0.3, 0.7, mx_noise_float(at.mul(0.21)).mul(0.5).add(0.5)).mul(amount));
  };
  const planar = (albedo: THREE.Texture, nor: THREE.Texture, tile: number, anti: number, strength = 1) => {
    const at = xz.div(tile);
    const c = antiTiled(albedo, at, anti).rgb;
    const t = texture(nor, at).xyz.mul(2).sub(1);
    return { c, n: normalize(nGeom.add(vec3(t.x, 0, t.y.negate()).mul(strength))) };
  };
  const triplanar = (albedo: THREE.Texture, nor: THREE.Texture, tile: number, strength = 1) => {
    const w = pow(abs(nGeom), vec3(4)).toVar();
    const ws = w.div(w.x.add(w.y).add(w.z));
    const p = positionWorld.div(tile);
    const cx = texture(albedo, p.zy).rgb, cy = texture(albedo, p.xz).rgb, cz = texture(albedo, p.xy).rgb;
    const tx = texture(nor, p.zy).xyz.mul(2).sub(1), ty = texture(nor, p.xz).xyz.mul(2).sub(1), tz = texture(nor, p.xy).xyz.mul(2).sub(1);
    // Whiteout-style: each projection's tangent normal swizzled onto its axis.
    const nx = vec3(0, tx.y, tx.x).mul(strength), ny = vec3(ty.x, 0, ty.y.negate()).mul(strength), nz = vec3(tz.x, tz.y, 0).mul(strength);
    return {
      c: cx.mul(ws.x).add(cy.mul(ws.y)).add(cz.mul(ws.z)),
      n: normalize(nGeom.add(nx.mul(ws.x)).add(ny.mul(ws.y)).add(nz.mul(ws.z))),
    };
  };
  const turf = planar(turfAlbedo, turfNormal, 7, 0.7);
  const cliff = triplanar(rockAlbedo, rockNormal, 14, 1.6);
  const path = planar(pathAlbedo, pathNormal, 2.5, 0.6);
  const grassFar = GRASS.base.clone().lerp(GRASS.tip, 0.55);
  const fieldShare = smoothstep(0, GRASS.distance, positionView.z.negate()).mul(0.5).add(0.5);
  const turfColour = mix(turf.c.mul(color(lin(0.62, 0.74, 0.5))), color(grassFar), fieldShare).mul(macro(0.6));
  const cliffColour = cliff.c.mul(color(lin(0.78, 0.78, 0.8))).mul(macro(0.5));
  const pathColour = path.c.mul(color(lin(0.95, 0.8, 0.66))).mul(macro(0.3));
  const shoreColour = cliff.c.mul(color(lin(0.3, 0.31, 0.33)));
  const w0 = groundWeights(xz).toVar();
  // Height blend: each layer stands as high as its albedo is bright.
  const lift = vec4(luminance(turf.c), luminance(cliff.c), luminance(path.c), luminance(cliff.c)).mul(0.5);
  const hw = w0.add(lift).toVar();
  const top = max(max(hw.x, hw.y), max(hw.z, hw.w)).sub(0.25);
  const sharp = max(hw.sub(top), vec4(0)).mul(step(1e-3, w0)).toVar();
  const w = sharp.div(max(sharp.x.add(sharp.y).add(sharp.z).add(sharp.w), 1e-4)).toVar();
  const material = new THREE.MeshStandardNodeMaterial();
  material.colorNode = turfColour.mul(w.x).add(cliffColour.mul(w.y)).add(pathColour.mul(w.z)).add(shoreColour.mul(w.w));
  material.roughnessNode = float(0.95).mul(w.x).add(float(0.9).mul(w.y)).add(float(1).mul(w.z)).add(float(0.45).mul(w.w));
  material.metalnessNode = float(0);
  material.normalNode = transformNormalToView(normalize(turf.n.mul(w.x).add(cliff.n.mul(w.y)).add(path.n.mul(w.z)).add(cliff.n.mul(w.w))));

  // The mesh: one vertex per sample, in 8 x 8 chunks for culling.
  const CHUNKS = 8, CELLS = N / CHUNKS;
  const at = (i: number, j: number) => heights[Math.min(N, Math.max(0, j)) * SAMPLES + Math.min(N, Math.max(0, i))]!;
  const step_ = SIZE / N;
  const index: number[] = [];
  for (let j = 0; j < CELLS; j++) for (let i = 0; i < CELLS; i++) {
    const a = j * (CELLS + 1) + i, b = a + 1, c = a + CELLS + 1, d = c + 1;
    index.push(a, c, b, b, c, d);
  }
  for (let cz = 0; cz < CHUNKS; cz++) for (let cx = 0; cx < CHUNKS; cx++) {
    const pos = new Float32Array((CELLS + 1) ** 2 * 3), nor = new Float32Array((CELLS + 1) ** 2 * 3);
    for (let j = 0; j <= CELLS; j++) for (let i = 0; i <= CELLS; i++) {
      const gi = cx * CELLS + i, gj = cz * CELLS + j, k = (j * (CELLS + 1) + i) * 3;
      pos[k] = gi * step_ - SIZE / 2; pos[k + 1] = at(gi, gj); pos[k + 2] = gj * step_ - SIZE / 2;
      const n = new THREE.Vector3(at(gi - 1, gj) - at(gi + 1, gj), 2 * step_, at(gi, gj - 1) - at(gi, gj + 1)).normalize();
      nor[k] = n.x; nor[k + 1] = n.y; nor[k + 2] = n.z;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    g.setIndex(index);
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, material);
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
  }
}

// bench-feature end
// --- the models (coast.ts, wanderer.ts) ----------------------------------------------
const loadModel = (name: string) => gltfLoader.loadAsync(`./content/models/${name}.glb`).catch((e) => {
  // A model og's glTF export has not made yet: drawn as nothing, loudly.
  console.error(`the-last-light: no ${name}.glb (${e})`);
  return { scene: new THREE.Group(), animations: [] as THREE.AnimationClip[] };
});
const MODELS = ["lighthouse", "cottage", "ruin", "rock-cliff", "boulder", "sea-stack", "wanderer", "lantern", "hawthorn", "staff", "plume-grass", "oxeye", "buttercup", "thrift", "foxglove"] as const;
const models = Object.fromEntries(await Promise.all(MODELS.map(async (n) => [n, await loadModel(n)] as const))) as Record<(typeof MODELS)[number], Awaited<ReturnType<typeof loadModel>>>;
const shadows = (o: THREE.Object3D, cast = true) => o.traverse((m) => { if ((m as THREE.Mesh).isMesh) { m.castShadow = cast; m.receiveShadow = true; } });

/** coast.ts `place`: a generated model is a unit cube about its centre, scaled to `size` and sunk into the ground. */
const place = (name: (typeof MODELS)[number], x: number, z: number, size: number, half: number, turn = 0, sink = 0.3) => {
  const k = size / 1.9;
  const o = models[name].scene.clone();
  o.position.set(x, heightAt(x, z) + half * k - sink, z);
  o.quaternion.setFromAxisAngle(UP, turn);
  o.scale.setScalar(k);
  shadows(o);
  scene.add(o);
  return o.position.y;
};
const base = place("lighthouse", LIGHTHOUSE.x, LIGHTHOUSE.z, LIGHTHOUSE.height, 0.95, 0.4);
place("cottage", COTTAGE.x, COTTAGE.z, COTTAGE.length, 0.43, 0.2, 0.5);
place("ruin", RUIN.x, RUIN.z, RUIN.length, 0.55, -0.3, 0.5);
place("rock-cliff", -8.5, -5.5, 9, 0.6, 2.2, 1.2);
place("boulder", 2.6, -2.4, 2.4, 0.27, 0.6, 0.15);
place("sea-stack", 58, -80, 15, 0.33, 0.3, 2.2);
place("sea-stack", 29, -28, 11, 0.33, 2.4, 2.0);
place("sea-stack", 40, -50, 14, 0.33, 4.1, 2.2);
place("rock-cliff", 43, -84, 11, 0.6, 3.6, 2.5);

// The hawthorn on the crag, its leaves in the season's colour (og.Model.tint).
{
  const tree = models.hawthorn.scene.clone();
  tree.position.set(-6.2, heightAt(-6.2, -1.6) + 1.2, -1.6);
  tree.quaternion.setFromAxisAngle(UP, 2.6);
  const tint = lin(0.2, 0.36, 0.1);
  tree.traverse((m) => {
    const mesh = m as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
    mat.color.multiply(tint);
    mesh.material = mat;
  });
  shadows(tree);
  scene.add(tree);
}

// The lamp room and the beam (lighthouse.ts): the beam goes round once every
// twelve seconds, a little below level, with its haze along it.
const PERIOD = 12, START = 0.64, DIP = 0.03, REACH = 170, WIDTH = 16;
const lamp = new THREE.Vector3(LIGHTHOUSE.x, base + LIGHTHOUSE.height * 0.38, LIGHTHOUSE.z);
{
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.55, 32, 16), new THREE.MeshStandardMaterial({ color: lin(1, 0.85, 0.55), emissive: lin(1, 0.78, 0.42), emissiveIntensity: 30 }));
  bulb.position.copy(lamp);
  scene.add(bulb);
  const glow = new THREE.PointLight(lin(1, 0.8, 0.5), 40, 30, 2);
  glow.position.copy(lamp);
  scene.add(glow);
}
const beam = new THREE.SpotLight(lin(1, 0.86, 0.6), 120000, 420, 0.06, 0.5, 2);
beam.position.copy(lamp);
scene.add(beam, beam.target);
const beamAt = (seconds: number) => new THREE.Quaternion().setFromAxisAngle(UP, START - (seconds / PERIOD) * 2 * Math.PI)
  .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -DIP));
// The haze the beam shows in (og.FogVolume colour (1, 0.95, 0.88), density
// 0.008, scattering 1, fading over 5 m past the box), lit by the beam alone.
const VOLUME_LAYER = 10;
const haze = new THREE.VolumeNodeMaterial();
haze.steps = 128;
haze.offsetNode = bayer16(screenCoordinate);
const FADE = 5;
const hazeBox = new THREE.Mesh(new THREE.BoxGeometry(WIDTH + 2 * FADE, WIDTH + 2 * FADE, REACH + 2 * FADE), haze);
{
  const inv = uniform(new THREE.Matrix4());
  const lampAt = uniform(lamp);
  inv.onObjectUpdate(() => inv.value.copy(hazeBox.matrixWorld).invert());
  haze.scatteringNode = Fn(({ positionRay }: { positionRay: any }) => {
    const local = inv.mul(vec4(positionRay, 1)).xyz;
    // og.Volume fade 5: 1 inside the box, falling linearly over 5 m past its surface (volumetric.wgsl).
    const past = length(max(abs(local).sub(vec3(WIDTH / 2, WIDTH / 2, REACH / 2)), vec3(0)));
    const edge = float(1).sub(past.div(FADE)).clamp(0, 1);
    // A metre's scattering in the volume's colour, times 100 (the volume
    // model scales a step's by 0.01), with og.Fog's Henyey-Greenstein phase
    // (anisotropy 0.6, volumetric.wgsl hg_phase): bright where the beam
    // points towards the eye.
    const g = 0.6;
    const cosTheta = dot(normalize(positionRay.sub(cameraPosition)), normalize(lampAt.sub(positionRay)));
    const phase = float((1 - g * g) / (4 * Math.PI)).div(pow(float(1 + g * g).sub(cosTheta.mul(2 * g)), 1.5));
    return color(lin(1, 0.95, 0.88)).mul(phase.mul(0.008 * 100)).mul(edge);
  });
}
hazeBox.layers.disableAll();
hazeBox.layers.enable(VOLUME_LAYER);
beam.layers.enable(VOLUME_LAYER);
scene.add(hazeBox);
const aim = (seconds: number) => {
  const q = beamAt(seconds);
  const along = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
  beam.target.position.copy(lamp).addScaledVector(along, 100);
  hazeBox.quaternion.copy(q);
  hazeBox.position.copy(lamp).addScaledVector(along, REACH / 2 + 4);
};
aim(0);

// --- the wanderer (wanderer.ts) ----------------------------------------------------
const FACING = Math.PI - 0.12, RIGHT_HAND = 15;
const feet = new THREE.Vector3(WANDERER.x, heightAt(WANDERER.x, WANDERER.z), WANDERER.z);
const c_ = Math.cos(FACING), s_ = Math.sin(FACING);
const at = (x: number, y: number, z: number) => new THREE.Vector3(feet.x + x * c_ + z * s_, feet.y + y, feet.z - x * s_ + z * c_);
const wanderer = models.wanderer.scene;
wanderer.position.copy(feet);
wanderer.quaternion.setFromAxisAngle(UP, FACING);
shadows(wanderer);
scene.add(wanderer);
const mixer = new THREE.AnimationMixer(wanderer);
const idle = models.wanderer.animations.find((a) => a.name === "Long_Breathe_and_Look_Around")!;
const action = mixer.clipAction(idle);
action.play();
let skinned: THREE.SkinnedMesh | undefined;
wanderer.traverse((m) => { if (!skinned && (m as THREE.SkinnedMesh).isSkinnedMesh) skinned = m as THREE.SkinnedMesh; });
const LEAN = 0.04;
{
  const staff = models.staff.scene.clone();
  staff.position.copy(at(-0.36, -0.03, 0.3));
  staff.quaternion.setFromAxisAngle(UP, FACING + Math.PI).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), LEAN));
  shadows(staff);
  scene.add(staff);
}
// bench-feature ik
// og.IkChain (bones 2): the hand on the staff's grip, the elbow towards the
// pole. three.js ships CCD IK only; this is the analytic two-bone solve.
const grip = at(-0.36 + 1.3 * LEAN, 1.3, 0.3), pole = at(-0.55, 0.8, -0.6);
const solveArm = () => {
  if (!skinned) return;
  const hand = skinned.skeleton.bones[RIGHT_HAND]!, fore = hand.parent as THREE.Bone, upper = fore.parent as THREE.Bone;
  wanderer.updateMatrixWorld(true);
  const pa = upper.getWorldPosition(new THREE.Vector3()), pb = fore.getWorldPosition(new THREE.Vector3()), pc = hand.getWorldPosition(new THREE.Vector3());
  const la = pa.distanceTo(pb), lb = pb.distanceTo(pc);
  const toTarget = grip.clone().sub(pa);
  const d = Math.min(Math.max(toTarget.length(), 1e-4), (la + lb) * 0.9999);
  const dir = toTarget.normalize();
  const bendAxis = pole.clone().sub(pa);
  bendAxis.sub(dir.clone().multiplyScalar(bendAxis.dot(dir))).normalize();
  const cosA = (la * la + d * d - lb * lb) / (2 * la * d);
  const elbow = pa.clone().addScaledVector(dir, la * cosA).addScaledVector(bendAxis, la * Math.sqrt(Math.max(0, 1 - cosA * cosA)));
  const turn = (bone: THREE.Bone, from: THREE.Vector3, to: THREE.Vector3) => {
    const parentWorld = bone.parent!.getWorldQuaternion(new THREE.Quaternion());
    const boneWorld = bone.getWorldQuaternion(new THREE.Quaternion());
    const delta = new THREE.Quaternion().setFromUnitVectors(from.normalize(), to.normalize());
    bone.quaternion.copy(parentWorld.invert().multiply(delta.multiply(boneWorld)));
    bone.updateMatrixWorld(true);
  };
  turn(upper, pb.clone().sub(pa), elbow.clone().sub(pa));
  const pb2 = fore.getWorldPosition(new THREE.Vector3()), pc2 = hand.getWorldPosition(new THREE.Vector3());
  turn(fore, pc2.sub(pb2), grip.clone().sub(pb2));
};
// bench-feature end
// The lantern on its cord from the staff's hook, its flame's light shadowed.
{
  const hook = at(-0.36 - 0.13 + 1.74 * LEAN, 1.74, 0.3);
  const cord = 0.42, size = 1.25;
  const lantern = models.lantern.scene.clone();
  lantern.position.set(hook.x, hook.y - cord - 0.294 * size, hook.z);
  lantern.scale.setScalar(size);
  shadows(lantern);
  scene.add(lantern);
  // bench-feature rope (og.Rope's cord, drawn still)
  const line = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, cord, 6), new THREE.MeshStandardMaterial({ color: lin(0.12, 0.09, 0.06) }));
  line.position.set(hook.x, hook.y - cord / 2, hook.z);
  scene.add(line);
  // bench-feature end
  const flamePos = new THREE.Vector3(hook.x, hook.y - cord - 0.2 * size, hook.z);
  const flame = new THREE.Mesh(new THREE.SphereGeometry(0.03 * size, 16, 8), new THREE.MeshStandardMaterial({ color: lin(1, 0.75, 0.4), emissive: lin(1, 0.62, 0.22), emissiveIntensity: 2.5 }));
  flame.position.copy(flamePos);
  scene.add(flame);
  const light = new THREE.PointLight(lin(1, 0.62, 0.26), 2.2, 7, 2);
  light.position.copy(flamePos);
  light.castShadow = true;
  light.shadow.mapSize.set(512, 512);
  scene.add(light);
}

// bench-feature grass
// --- the grass (og.Grass over the turf layer: 700 a square metre to 120 m) --------
// Hand-written, after og.Grass (bevy_grass's scheme): a progressive
// blue-noise tile of 1024 candidates copied over 16 m chunks, each copy
// shifted by a hash of its chunk and cell; a candidate is a blade while its
// rank is under the density there (the turf's weight times the distance
// table), so the field thins out evenly and the survivors widen. One
// instanced draw per chunk in view, at one of three levels of detail (7, 3
// and 1 rows), at most 2^21 blades a frame.
const CHUNK = 16, TILE_POINTS = 1024, MAX_BLADES = 1 << 21;
const pcg = (v: number) => {
  const state = (Math.imul(v >>> 0, 747796405) + 2891336453) >>> 0;
  const word = Math.imul(((state >>> ((state >>> 28) + 4)) ^ state) >>> 0, 277803737) >>> 0;
  return ((word >>> 22) ^ word) >>> 0;
};
const unit24 = (h: number) => (h >>> 8) / 16777216;
const blueNoise = (() => {
  const pts: THREE.Vector2[] = [];
  let rng = 0x6b8a3a00;
  const next = () => { rng = pcg(rng); return unit24(rng); };
  while (pts.length < TILE_POINTS) {
    let best = new THREE.Vector2(), bestD = -1;
    for (let k = 0; k < 12; k++) {
      const c = new THREE.Vector2(next(), next());
      let d = Infinity;
      for (const p of pts) {
        const dx = Math.abs(p.x - c.x), dy = Math.abs(p.y - c.y);
        d = Math.min(d, Math.min(dx, 1 - dx) ** 2 + Math.min(dy, 1 - dy) ** 2);
      }
      if (d > bestD) { best = c; bestD = d; }
    }
    pts.push(best);
  }
  return pts;
})();
const tiles = Math.min(64, Math.max(1, Math.ceil(CHUNK * Math.sqrt(GRASS.density / TILE_POINTS))));
const tile = CHUNK / tiles, cells = tiles * tiles, candidates = TILE_POINTS / (tile * tile);
const lod = { lod1: 0.2 * GRASS.distance, lod2: 0.5 * GRASS.distance, edge: 0.8 * GRASS.distance, band: 4 };
const falloff = (d: number) => {
  const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.min(1, Math.max(0, t));
  const thin = d <= lod.lod1 ? 1 : d <= lod.lod2 ? lerp(1, 0.5, (d - lod.lod1) / (lod.lod2 - lod.lod1))
    : d <= lod.edge ? lerp(0.5, 0.15, (d - lod.lod2) / (lod.edge - lod.lod2)) : lerp(0.15, 0, (d - lod.edge) / (GRASS.distance - lod.edge));
  const into = Math.min(1, Math.max(0, (d - (lod.lod1 - lod.band / 2)) / lod.band));
  return thin * (1 + (0.5 - 1) * into);
};
const blueTile = uniformArray(blueNoise, "vec2");
const bladeMaterial = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide });
{
  // Per chunk: its corner (x, z), the share of blades kept and how wide survivors grow.
  const chunk = uniform(new THREE.Vector4()).onObjectUpdate(({ object }: { object: THREE.Object3D }) => object.userData.chunk);
  const k = instanceIndex;
  const cell = k.mod(uint(cells)), rank = k.div(uint(cells));
  const ci = cell.mod(uint(tiles)), cj = cell.div(uint(tiles));
  const seed = chunk.x.mul(0.37).add(chunk.y.mul(1.91)).add(float(cell).mul(0.013));
  const q = fract(blueTile.element(rank).add(vec2(hash(seed), hash(seed.add(17.3)))));
  const root = vec2(chunk.x, chunk.y).add(vec2(float(ci), float(cj)).add(q).mul(tile)).toVar();
  const r1 = hash(float(k).add(chunk.x.mul(131.7)).add(chunk.y.mul(57.1))).toVar();
  const r2 = hash(r1.mul(913.1)).toVar(), r3 = hash(r2.mul(711.3)).toVar();
  // Clumps: a cell of clumpSize metres, each with its lean and dryness.
  const clump = floor(root.div(GRASS.clumpSize)).toVar();
  const ch = hash(clump.x.mul(12.9898).add(clump.y.mul(78.233))).toVar();
  const turf = drawnWeights(root).x;
  const alive = step(r3, turf).toVar();
  const ground = groundHeight(root);
  const h = float(GRASS.height).mul(float(1).sub(r1.mul(GRASS.heightVariation))).mul(alive);
  const yaw = r2.mul(Math.PI * 2);
  const across = vec3(cos(yaw), 0, sin(yaw)).toVar();
  const facing = vec3(sin(yaw).negate(), 0, cos(yaw)).toVar();
  const clumpDir = vec2(hash(ch.mul(3.1)).sub(0.5), hash(ch.mul(5.7)).sub(0.5)).mul(2 * GRASS.clumpLean);
  // og.Wind: a travelling wave downwind, with gusts and a sway per blade.
  const wind = vec2(WIND.x, WIND.z);
  const phase = dot(root, wind).mul(0.35).sub(pathTime.mul(WIND.speed * 0.35)).add(r1.mul(6.28));
  const gust = mx_noise_float(vec2(root.add(wind.mul(pathTime.mul(WIND.speed * -0.6))).mul(1 / 14))).mul(0.5).add(0.5);
  const push = gust.mul(0.35).add(sin(phase).mul(0.12)).mul(GRASS.sway * WIND.speed / 10);
  const y = positionGeometry.y;
  const bend = y.mul(y);
  const lean = facing.mul(float(GRASS.lean).mul(bend)).add(vec3(clumpDir.x, 0, clumpDir.y).mul(bend))
    .add(vec3(wind.x, 0, wind.y).mul(push.mul(bend)));
  const droop = float(1).sub(float(GRASS.curve).mul(0.35).mul(bend));
  const width = float(GRASS.width).mul(chunk.w).mul(float(1).sub(y.mul(0.85)));
  const p = vec3(root.x, ground, root.y).add(across.mul(positionGeometry.x.mul(width))).add(vec3(0, y.mul(h).mul(droop), 0)).add(lean.mul(h));
  bladeMaterial.positionNode = p;
  bladeMaterial.normalNode = transformNormalToView(normalize(facing.add(vec3(0, 0.6, 0)).add(across.mul(positionGeometry.x.mul(0.6)))));
  const dry = step(ch, GRASS.dryness);
  const vary = hash(ch.mul(17.7)).sub(0.5).mul(GRASS.colorVariation).add(1);
  const shade = mix(color(GRASS.base), mix(color(GRASS.tip), color(GRASS.dry), dry.mul(0.7)), varying(y.pow(0.8))).mul(vary);
  bladeMaterial.colorNode = shade;
  bladeMaterial.roughnessNode = float(GRASS.roughness);
  bladeMaterial.metalnessNode = float(0);
  // Light through a blade lit from behind (translucency 0.6).
  const back = pow(max(dot(normalize(positionWorld.sub(cameraPosition)), vec3(TO_SUN.x, TO_SUN.y, TO_SUN.z)), 0), 4);
  bladeMaterial.emissiveNode = shade.mul(color(SUN_LIGHT)).mul(back.mul(GRASS.translucency * 0.5)).mul(varying(y));
}
const blade = (rows: number) => {
  const pos: number[] = [], index: number[] = [];
  for (let i = 0; i < rows; i++) { const y = i / rows; pos.push(-0.5, y, 0, 0.5, y, 0); }
  pos.push(0, 1, 0);
  for (let i = 0; i < rows - 1; i++) { const a = i * 2; index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const t = (rows - 1) * 2;
  index.push(t, t + 1, t + 2);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  return g;
};
const bladeLevels = [blade(7), blade(3), blade(1)];
type GrassChunk = { mesh: THREE.Mesh<THREE.InstancedBufferGeometry>; x: number; z: number; levels: THREE.InstancedBufferGeometry[] };
const grassChunks = new Map<string, GrassChunk>();
const chunkOf = (cx: number, cz: number) => {
  const key = `${cx},${cz}`;
  let g = grassChunks.get(key);
  if (!g) {
    const x = cx * CHUNK - SIZE / 2, z = cz * CHUNK - SIZE / 2;
    const levels = bladeLevels.map((l) => {
      const geo = new THREE.InstancedBufferGeometry();
      geo.index = l.index;
      geo.attributes = l.attributes;
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(x + CHUNK / 2, heightAt(x + CHUNK / 2, z + CHUNK / 2), z + CHUNK / 2), CHUNK);
      return geo;
    });
    const mesh = new THREE.Mesh(levels[0]!, bladeMaterial);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.chunk = new THREE.Vector4(x, z, 1, 1);
    scene.add(mesh);
    g = { mesh, x, z, levels };
    grassChunks.set(key, g);
  }
  return g;
};
// Chunks with no turf grow nothing.
const turfChunk = (cx: number, cz: number) => {
  for (let j = 0; j <= 4; j++) for (let i = 0; i <= 4; i++) {
    const x = cx * CHUNK - SIZE / 2 + (i / 4) * CHUNK, z = cz * CHUNK - SIZE / 2 + (j / 4) * CHUNK;
    if (weightsAt(x, z)[0]! > 0.02) return true;
  }
  return false;
};
// Each grassable chunk's box: its ground's height range and the tallest blade.
const grassable = new Map<string, THREE.Box3>();
for (let cz = 0; cz < SIZE / CHUNK; cz++) for (let cx = 0; cx < SIZE / CHUNK; cx++) {
  if (!turfChunk(cx, cz)) continue;
  const x = cx * CHUNK - SIZE / 2, z = cz * CHUNK - SIZE / 2;
  let lo = Infinity, hi = -Infinity;
  for (let j = 0; j <= 8; j++) for (let i = 0; i <= 8; i++) {
    const y = heightAt(x + (i / 8) * CHUNK, z + (j / 8) * CHUNK);
    lo = Math.min(lo, y); hi = Math.max(hi, y);
  }
  const tall = GRASS.height * (1 + Math.abs(GRASS.lean) + Math.abs(GRASS.clumpLean));
  grassable.set(`${cx},${cz}`, new THREE.Box3(new THREE.Vector3(x, lo - 0.5, z), new THREE.Vector3(x + CHUNK, hi + 0.5 + tall, z + CHUNK)));
}
const view = new THREE.Frustum(), viewProj = new THREE.Matrix4();
// What the field drew last frame, for the harness (window.__benchVegetation).
const grassStats = { chunks: 0, blades: 0, budgetShare: 1 };
const growGrass = () => {
  const eye = camera.position;
  // og.Grass plan(): only chunks in view share the 2^21-blade budget.
  view.setFromProjectionMatrix(viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  const keep: [GrassChunk, number, number][] = [];
  for (const g of grassChunks.values()) g.mesh.visible = false;
  let total = 0;
  for (const [key, box] of grassable) {
    const [cx, cz] = key.split(",").map(Number) as [number, number];
    const x = cx * CHUNK - SIZE / 2, z = cz * CHUNK - SIZE / 2;
    const dx = Math.max(x - eye.x, 0, eye.x - (x + CHUNK)), dz = Math.max(z - eye.z, 0, eye.z - (z + CHUNK));
    const d = Math.hypot(dx, dz);
    if (d >= GRASS.distance || !view.intersectsBox(box)) continue;
    const f = falloff(d);
    const share = Math.min(1, (GRASS.density * f) / candidates);
    if (share <= 0) continue;
    const g = chunkOf(cx, cz);
    keep.push([g, share, d]);
    total += Math.ceil(share * TILE_POINTS) * cells;
  }
  const cap = Math.min(1, MAX_BLADES / Math.max(1, total));
  let blades = 0;
  for (const [g, share, d] of keep) {
    const level = d < lod.lod1 ? 0 : d < lod.lod2 ? 1 : 2;
    const geo = g.levels[level]!;
    geo.instanceCount = Math.ceil(share * cap * TILE_POINTS) * cells;
    g.mesh.geometry = geo;
    g.mesh.userData.chunk.w = Math.min(2.5, 1 / Math.sqrt(Math.max(share * cap * candidates / GRASS.density, 1e-3)));
    g.mesh.visible = true;
    blades += geo.instanceCount;
  }
  Object.assign(grassStats, { chunks: keep.length, blades, budgetShare: cap });
};

// bench-feature end
// bench-feature scatter
// --- the five scatter layers (coast.ts `grow`, og.TerrainScatter) ----------------------
// Hand-written: og.TerrainScatter's own placement rules (Terrain::copy_at:
// one cell of 1/sqrt(density) metres per copy, the cell's hash for its
// place, the turf's weight, the patches of cluster noise with their dithered
// edges, the scale range and a turn), clear of the sea by 3 m, drawn as one
// InstancedMesh per 16 m chunk within the layer's distance.
const lowbias32 = (x: number) => {
  x = (x ^ (x >>> 16)) >>> 0; x = Math.imul(x, 0x7feb352d) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0; x = Math.imul(x, 0x846ca68b) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
};
const clusterNoise = (px: number, pz: number, seed: number) => {
  const lattice = (qx: number, qz: number, salt: number) => {
    const ix = Math.floor(qx), iz = Math.floor(qz), fx = qx - ix, fz = qz - iz;
    const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
    const h = (dx: number, dz: number) => unit24(lowbias32(((lowbias32(((ix + dx) ^ salt) >>> 0) + Math.imul((iz + dz) >>> 0, 0x9e3779b9)) ^ seed) >>> 0));
    const a = h(0, 0) + (h(1, 0) - h(0, 0)) * ux, b = h(0, 1) + (h(1, 1) - h(0, 1)) * ux;
    return a + (b - a) * uz;
  };
  const c = Math.cos(0.6), s = Math.sin(0.6);
  let qx = px, qz = pz, amp = 1, sum = 0, total = 0;
  for (let octave = 0; octave < 3; octave++) {
    sum += amp * lattice(qx, qz, Math.imul(octave, 0x632be5ab) >>> 0);
    total += amp;
    [qx, qz] = [(c * qx - s * qz) * 2.03, (s * qx + c * qz) * 2.03];
    amp *= 0.5;
  }
  return sum / total;
};
const smooth = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
type Layer = { name: (typeof MODELS)[number]; density: number; patch: number; threshold: number; seed: number; distance: number };
// climate.ts dresses every layer to the summer's scale: 0.8 to 1.25.
const LAYERS: Layer[] = [
  { name: "plume-grass", density: 0.7, patch: 9, threshold: 0.46, seed: 3, distance: 70 },
  { name: "oxeye", density: 5, patch: 5, threshold: 0.6, seed: 5, distance: 45 },
  { name: "buttercup", density: 5, patch: 4, threshold: 0.62, seed: 8, distance: 45 },
  { name: "thrift", density: 6, patch: 6, threshold: 0.6, seed: 13, distance: 45 },
  { name: "foxglove", density: 0.8, patch: 7, threshold: 0.55, seed: 21, distance: 45 },
];
type ScatterChunk = { meshes: THREE.InstancedMesh[]; x: number; z: number; distance: number; layer: string; count: number };
const scatterChunks: ScatterChunk[] = [];
for (const layer of LAYERS) {
  const cell = 1 / Math.sqrt(layer.density);
  const cellsX = Math.ceil(SIZE / cell);
  const seed = lowbias32((layer.seed ^ 0x9e3779b9) >>> 0);
  const buckets = new Map<string, THREE.Matrix4[]>();
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), tr = new THREE.Vector3();
  for (let z = 0; z < cellsX; z++) for (let x = 0; x < cellsX; x++) {
    const key = (Math.imul(z, cellsX) + x) >>> 0;
    const h0 = lowbias32((key ^ seed) >>> 0);
    const h1 = lowbias32(h0), h2 = lowbias32((h0 ^ 1) >>> 0), h3 = lowbias32((h0 ^ 2) >>> 0), h4 = lowbias32((h0 ^ 3) >>> 0);
    const px = (x + unit24(h1)) * cell - SIZE / 2, pz = (z + unit24(h2)) * cell - SIZE / 2;
    if (px > SIZE / 2 || pz > SIZE / 2) continue;
    if (unit24(h3) >= weightsAt(px, pz)[0]!) continue;
    const n = clusterNoise(px / layer.patch, pz / layer.patch, seed);
    if (unit24(lowbias32((h0 ^ 5) >>> 0)) >= smooth(layer.threshold - 0.04, layer.threshold + 0.04, n)) continue;
    const y = heightAt(px, pz);
    if (y < 3) continue; // avoidWater 3 over the endless sea at y 0
    const size = 0.8 + (1.25 - 0.8) * unit24(h4);
    q.setFromAxisAngle(UP, unit24(lowbias32((h0 ^ 4) >>> 0)) * Math.PI * 2);
    m.compose(tr.set(px, y, pz), q, sc.setScalar(size));
    const b = `${Math.floor((px + SIZE / 2) / CHUNK)},${Math.floor((pz + SIZE / 2) / CHUNK)}`;
    let list = buckets.get(b);
    if (!list) buckets.set(b, (list = []));
    list.push(m.clone());
  }
  const parts: THREE.Mesh[] = [];
  models[layer.name].scene.updateMatrixWorld(true);
  // TerrainScatter.sway 1: og.Wind moves each vertex downwind by its height
  // over the copy's root, with the gusts the grass takes.
  const windy = (m: THREE.MeshStandardMaterial) => {
    const n = new THREE.MeshStandardNodeMaterial();
    n.setValues({
      color: m.color, map: m.map, normalMap: m.normalMap, roughness: m.roughness, metalness: m.metalness, roughnessMap: m.roughnessMap,
      metalnessMap: m.metalnessMap, emissive: m.emissive, emissiveMap: m.emissiveMap, vertexColors: m.vertexColors, side: m.side,
      alphaTest: m.alphaTest, transparent: m.transparent, opacity: m.opacity, aoMap: m.aoMap,
    });
    // scatter_common.wgsl scatter_sway: the lean (og.Wind: 0.05 of the
    // height per m/s, gust 0.6) times the height and its share of the
    // plant's top, the stem kept its length by dropping as it bends.
    const y = positionGeometry.y.max(0);
    const g = windGust(positionLocal.xz);
    const lean = vec2(WIND.x, WIND.z).mul(0.05 * WIND.speed).mul(g.mul(2).sub(1).mul(0.6).add(1));
    const d = lean.mul(y).mul(min(y.div(top), 1));
    const dl = min(length(d), y);
    const drop = y.sub(sqrt(max(y.mul(y).sub(dl.mul(dl)), 0)));
    n.positionNode = positionLocal.add(vec3(d.x, drop.negate(), d.y));
    // Light through a leaf or petal lit from behind: three.js ignores the
    // glTF's KHR_materials_diffuse_transmission, so it is added as the
    // hand-written grass's is, at the material's own factor.
    const through = (m.userData.gltfExtensions?.KHR_materials_diffuse_transmission?.diffuseTransmissionFactor ?? 0) as number;
    if (through > 0) {
      const back = pow(max(dot(normalize(positionWorld.sub(cameraPosition)), vec3(TO_SUN.x, TO_SUN.y, TO_SUN.z)), 0), 4);
      const base = m.vertexColors ? materialColor.mul(vertexColor()) : materialColor;
      n.emissiveNode = base.rgb.mul(color(SUN_LIGHT)).mul(back.mul(through * 0.5));
    }
    return n;
  };
  models[layer.name].scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) parts.push(o as THREE.Mesh); });
  const top = new THREE.Box3().setFromObject(models[layer.name].scene).max.y;
  for (const [b, list] of buckets) {
    const [bx, bz] = b.split(",").map(Number) as [number, number];
    const meshes = parts.map((part) => {
      const geo = part.geometry.clone().applyMatrix4(part.matrixWorld);
      const im = new THREE.InstancedMesh(geo, windy(part.material as THREE.MeshStandardMaterial), list.length);
      list.forEach((mm, i) => im.setMatrixAt(i, mm));
      im.computeBoundingSphere();
      im.castShadow = false; // castShadows false
      im.receiveShadow = true;
      im.visible = false;
      scene.add(im);
      return im;
    });
    scatterChunks.push({ meshes, x: bx * CHUNK - SIZE / 2, z: bz * CHUNK - SIZE / 2, distance: layer.distance, layer: layer.name, count: list.length });
  }
}
// The copies each layer has within its distance, for the harness.
const scatterStats: Record<string, number> = {};
const growScatter = () => {
  const eye = camera.position;
  for (const l of LAYERS) scatterStats[l.name] = 0;
  for (const c of scatterChunks) {
    // Within `distance` of the camera along x and z.
    const dx = Math.max(c.x - eye.x, 0, eye.x - (c.x + CHUNK)), dz = Math.max(c.z - eye.z, 0, eye.z - (c.z + CHUNK));
    const shown = Math.max(dx, dz) < c.distance;
    for (const m of c.meshes) m.visible = shown;
    if (shown) scatterStats[c.layer]! += c.count;
  }
};

// bench-feature end
// bench-feature sea
// --- the sea (og.Water: endless, swell 1.8, choppiness 0.9, wind 12.3 m/s) --------------
// Hand-written: three.js's WaterMesh is a flat mirror; og.Water's swell,
// its shoaling and foam on the rocks are drawn here as Gerstner waves on a
// grid that follows the camera, its colour from deep to shallow by the depth
// over the seabed, foam where it is shallow, and the sky's light as its
// reflection (the environment map).
const sea = (() => {
  const geo = new THREE.PlaneGeometry(6000, 6000, 256, 256).rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardNodeMaterial();
  const origin = uniform(new THREE.Vector3());
  const waves = [
    { dir: [-0.894, 0.447], length: 60, amp: 0.55 }, { dir: [-0.8, 0.6], length: 31, amp: 0.3 },
    { dir: [-0.97, 0.24], length: 17, amp: 0.14 }, { dir: [-0.6, 0.8], length: 9, amp: 0.07 },
  ].map((w) => ({ ...w, amp: w.amp * (1.8 / 1.25) }));
  const gerstner = (p: any) => {
    let off = vec3(0), tx = vec3(1, 0, 0), tz = vec3(0, 0, 1);
    for (const w of waves) {
      const k = (2 * Math.PI) / w.length, c = Math.sqrt(9.8 / k), d = { x: w.dir[0]!, y: w.dir[1]! };
      const f = dot(vec2(d.x, d.y), p).mul(k).sub(pathTime.mul(c * k));
      const steep = 0.9 / (k * w.amp * waves.length);
      const a = w.amp, q = steep * a;
      off = off.add(vec3(cos(f).mul(q * d.x), sin(f).mul(a), cos(f).mul(q * d.y)));
      tx = tx.add(vec3(sin(f).mul(-q * k * d.x * d.x), cos(f).mul(a * k * d.x), sin(f).mul(-q * k * d.x * d.y)));
      tz = tz.add(vec3(sin(f).mul(-q * k * d.x * d.y), cos(f).mul(a * k * d.y), sin(f).mul(-q * k * d.y * d.y)));
    }
    return { off, n: normalize(tz.cross(tx)) };
  };
  const flat = positionGeometry.xz.add(origin.xz).toVar();
  const depth = max(groundHeight(flat).negate(), 0).toVar();
  // The swell rises as it shoals and the sea is still where the land stands.
  const shoal = smoothstep(0, 1.5, depth).mul(smoothstep(40, 6, depth).mul(0.4).add(1));
  const g = gerstner(flat);
  mat.positionNode = vec3(flat.x, 0, flat.y).add(g.off.mul(shoal));
  const d = varying(depth);
  // Ripples on the swell, by the wind.
  const fine = vec2(mx_noise_float(positionWorld.xz.mul(0.35).add(pathTime.mul(0.4))), mx_noise_float(positionWorld.xz.mul(0.35).add(19.1).sub(pathTime.mul(0.33)))).mul(0.25);
  mat.normalNode = transformNormalToView(normalize(varying(g.n).add(vec3(fine.x, 0, fine.y))));
  const body = mix(color(lin(0.2, 0.5, 0.55)), color(lin(0.01, 0.06, 0.09)), smoothstep(0, 12, d)); // depthFade 12
  const foam = smoothstep(1.2 * 1.6, 0, d).mul(smoothstep(0.35, 0.65, mx_noise_float(positionWorld.xz.mul(0.6).add(pathTime.mul(0.2))).mul(0.5).add(0.5)));
  mat.colorNode = mix(body, color(lin(0.95, 0.97, 1)), foam);
  mat.roughnessNode = mix(float(0.06), float(0.8), foam);
  mat.metalnessNode = float(0);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  scene.add(mesh);
  return { follow: () => origin.value.set(Math.round(camera.position.x / 25) * 25, 0, Math.round(camera.position.z / 25) * 25) };
})();

// bench-feature end
// bench-feature fog
// --- the air: og.Fog (clear: density 5e-5, sea mist 0.0022 under 3 m, falloff 0.11) --
// Hand-written: the height fog's analytic integral along the view ray, its
// colour the sky's mean light and the sun's forward scattering (sunColor,
// sunPower 8).
{
  const FOG = { density: 0.00005, heightDensity: 0.0022, height: 3, falloff: 0.11, sunPower: 8 };
  const fogColour = lin(0.62, 0.45, 0.42);
  const sunGlow = lin(1, 0.86, 0.62).multiply(SUN_LIGHT).multiplyScalar(2);
  const fogNode = Fn(() => {
    const ray = positionWorld.sub(cameraPosition).toVar();
    const dist = length(ray), dir = ray.div(max(dist, 1e-4));
    const k = float(FOG.falloff);
    const h0 = cameraPosition.y.sub(FOG.height);
    const dy = dir.y.mul(dist).mul(k);
    const column = abs(dy).lessThan(1e-4).select(dist, float(1).sub(exp(dy.negate())).div(max(abs(dir.y.mul(k)), 1e-5)).mul(dy.sign()));
    const optical = float(FOG.density).mul(dist).add(float(FOG.heightDensity).mul(exp(h0.mul(k).negate())).mul(column.max(0)));
    const amount = float(1).sub(exp(optical.negate()));
    const glow = pow(max(dot(dir, vec3(TO_SUN.x, TO_SUN.y, TO_SUN.z)), 0), FOG.sunPower);
    return vec4(color(fogColour).add(color(sunGlow).mul(glow)), amount);
  })();
  scene.fogNode = fog(fogNode.rgb, fogNode.a);
}

// bench-feature end
// --- the frame (looks/the-last-light.ogt over cinematic-realism, mood warm) ------------
const pipeline = new THREE.RenderPipeline(renderer);
pipeline.outputColorTransform = false;
// A depth and normal prepass for the ambient occlusion.
const prePass = pass(scene, camera);
prePass.transparent = false;
prePass.setMRT(mrt({ output: packNormalToRGB(normalView) }));
prePass.getTexture("output").type = THREE.UnsignedByteType;
const preDepth = prePass.getTextureNode("depth");
const preNormal = sample((at: any) => unpackRGBToNormal(prePass.getTextureNode("output").sample(at)));
// Ambient occlusion on the ambient light (aoIntensity 1.2, aoRadius 0.6, full resolution).
const aoPass = ao(preDepth, preNormal, camera);
aoPass.radius.value = 0.6;
aoPass.resolutionScale = 1;
const aoTerm = pow(aoPass.getTextureNode().sample(screenUV).r, 1.2);
// The scene, 4x multisampled (three.js's antialiasing; Origin uses TAA).
const scenePass = pass(scene, camera, { samples: 4 });
scenePass.contextNode = builtinAOContext(aoTerm);
const sceneColor = scenePass.getTextureNode("output");
// The beam's haze at a quarter resolution, blurred and added.
const volumeLayer = new THREE.Layers();
volumeLayer.disableAll();
volumeLayer.enable(VOLUME_LAYER);
haze.depthNode = scenePass.getTextureNode("depth").sample(screenUV);
const volumePass = pass(scene, camera, { depthBuffer: false });
volumePass.setLayers(volumeLayer);
volumePass.setResolutionScale(0.25);
const lit = sceneColor.add(gaussianBlur(volumePass, 0.6));
// God rays (godRays, intensity 0.2, 48 samples, decay 0.965, density 1,
// threshold 2), hand-written as Origin's fxpost.wgsl has them: the mask
// (fs_godrays_mask) keeps the sky's light above the threshold by its
// luminance, at most 32, fading out half a frame from the sun; the blur
// (fs_godrays_blur) sums 48 taps towards the sun, normalised to 4/48.
// three.js's radialBlur adds the unblurred source back and has no fall-off,
// which veiled the whole frame.
const sunScreen = uniform(new THREE.Vector2(0.5, 0.5));
const sunAhead = uniform(1);
const aspect = uniform(16 / 9);
// What the rays come from: the sky alone, what lies beyond the sky dome's near side.
const skyMask = step(4000, scenePass.getViewZNode().negate());
const godMask = convertToTexture(Fn(() => {
  const c = lit.rgb;
  const lum = luminance(c);
  const kept = min(c.mul(max(lum.sub(2), 0)).div(max(lum, 1e-4)), vec3(32));
  const fall = pow(clamp(float(1).sub(screenUV.sub(sunScreen).mul(vec2(aspect, 1)).length().div(0.5)), 0, 1), 3);
  return vec4(kept.mul(fall).mul(skyMask), 1);
})());
// Each pixel's ray starts at one of sixteen phases, every 4x4 block holding
// all of them, and a 4x4 box resolves them into their integral, as Origin's
// fs_godrays_blur and fs_godrays_resolve do (GPU Gems 3 section 13.8); per-pixel
// noise left a dot lattice over the frame.
const raysRaw = convertToTexture(Fn(() => {
  const cell = screenCoordinate.xy.mod(4).floor();
  const phase = cell.x.add(cell.y.mul(4)).add(0.5).div(16);
  const stepUv = screenUV.sub(sunScreen).div(48).toConst();
  const at = screenUV.sub(stepUv.mul(phase.sub(0.5))).toVar();
  const sum = vec3(0).toVar();
  const decay = float(1).toVar();
  Loop(48, () => {
    sum.addAssign(godMask.sample(at).rgb.mul(decay));
    decay.mulAssign(0.965);
    at.subAssign(stepUv);
  });
  return vec4(sum.mul((4 / 48) * 0.2).mul(sunAhead), 1);
})());
const rays = Fn(() => {
  const texel = vec2(1).div(screenSize);
  const px = screenCoordinate.xy.floor();
  const sum = vec3(0).toVar();
  for (let y = -1; y <= 2; y++) for (let x = -1; x <= 2; x++) sum.addAssign(raysRaw.sample(px.add(vec2(x, y)).mul(texel)).rgb);
  return vec4(sum.div(16), 0);
})();
// Bloom (0.22 over a threshold of 1, knee 0.5).
const hdr0 = lit.add(rays);
const bloomPass = bloom(hdr0, 0.22, 0, 1);
bloomPass.smoothWidth.value = 0.5;
// Chromatic aberration 0.5 (as the Night Shift page: 0.036 of the frame at the corners).
const hdr = chromaticAberration(hdr0.add(bloomPass), uniform(0.036), vec2(0.5, 0.5), uniform(1));
// Tone mapping (AgX), then the grade in display colour: temperature 0.1 and
// tint 0.03 (warm), the highlights' balance (0.04, 0, -0.04), contrast 0.12,
// saturation 0.08, film grain 0.03 and the vignette (0.3, radius 0.55, smoothness 0.45).
const graded = Fn(() => {
  const c = renderOutput(hdr).rgb.toVar();
  const warm = vec3(1 + 0.1 * 0.1, 1, 1 - 0.1 * 0.1).mul(vec3(1, 1 - 0.03 * 0.05, 1));
  c.assign(c.mul(warm));
  const lum = luminance(c);
  c.assign(c.add(vec3(0.04, 0, -0.04).mul(smoothstep(0.5, 1, lum))));
  c.assign(c.sub(0.5).mul(1.12).add(0.5).clamp(0, 1));
  return saturation(c, 1.08);
})();
const grained = film(vec4(graded, 1), uniform(0.03));
const corner = screenUV.sub(0.5).length().div(Math.SQRT1_2);
const vignette = float(1).sub(smoothstep(0.55, 1.0, corner).mul(0.3));
pipeline.outputNode = vec4(grained.rgb.mul(vignette), 1);

// --- the clock and the benchmark's hooks ----------------------------------------
let startedAt = 0;
// ?at=<seconds> holds the camera and the beam at that path time, as the
// Origin bench copy's hold does (src/bench.ts); the clip, the wind and the
// sea run on.
const held = new URLSearchParams(location.search).get("at");
const liveSeconds = () => (startedAt ? (performance.now() - startedAt) / 1000 : 0);
const pathSeconds = () => (held !== null ? Number(held) : liveSeconds());
Object.assign(window, {
  __benchStart: () => { startedAt = performance.now(); },
  __benchPathSeconds: pathSeconds,
  __benchVegetation: () => ({ grass: { ...grassStats }, scatter: { ...scatterStats } }),
});
const sunWorld = new THREE.Vector3();
let marked = false;
function frame() {
  const t = pathSeconds(), live = held !== null ? Number(held) + liveSeconds() : t;
  placeCamera(Math.min(t, PATH_SECONDS));
  camera.updateMatrixWorld();
  pathTime.value = live;
  aim(t);
  action.time = live % idle.duration;
  mixer.update(0);
  solveArm();
  sea.follow();
  growGrass();
  growScatter();
  sunWorld.copy(camera.position).addScaledVector(TO_SUN, 1000).project(camera);
  sunScreen.value.set(sunWorld.x * 0.5 + 0.5, 0.5 - sunWorld.y * 0.5);
  // The rays need the sun in front of the camera (Origin's god2.y).
  sunAhead.value = sunWorld.z < 1 ? 1 : 0;
  aspect.value = camera.aspect;
  pipeline.render();
  if (!marked) {
    marked = true;
    performance.mark("bench:first-frame");
  }
}
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
renderer.setAnimationLoop(frame);
