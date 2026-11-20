// Night Shift in three.js (WebGPURenderer), rebuilt from the Origin game's
// own code (origin/night-shift/src: set.ts, cast.ts, air.ts and the look
// looks/night-shift.ogt) with the same numbers, and the same models and
// textures, exported once as glTF and KTX2 (scripts/export-content.sh).
// The weather is fixed where the game starts: rain, spring, night.
//
// It uses what three.js ships (the core and its official addons) and draws
// nothing the scene does not have; what three.js lacks is listed in the
// README's feature table, not imitated here.
import * as THREE from "three/webgpu";
import {
  Fn, builtinAOContext, color, float, fog, mix, positionView, mrt, normalView, packNormalToRGB, pass, positionWorldDirection,
  pow, renderOutput, sample, saturation, screenCoordinate, screenUV, smoothstep, uniform, unpackRGBToNormal, vec2, vec4, metalness, roughness, max, exp,
} from "three/tsl";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";
import { RectAreaLightTexturesLib } from "three/addons/lights/RectAreaLightTexturesLib.js";
import { CSMShadowNode } from "three/addons/csm/CSMShadowNode.js";
import { ao } from "three/addons/tsl/display/GTAONode.js";
import { ssr } from "three/addons/tsl/display/SSRNode.js";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { chromaticAberration } from "three/addons/tsl/display/ChromaticAberrationNode.js";
import { film } from "three/addons/tsl/display/FilmNode.js";
import { gaussianBlur } from "three/addons/tsl/display/GaussianBlurNode.js";
import { bayer16 } from "three/addons/tsl/math/Bayer.js";
import { cameraAt, PATH_SECONDS } from "../../origin/night-shift/src/camera-path.ts";

// --- the scene's vocabulary (origin/night-shift/src/util.ts, palette.ts) ----
const DEG = Math.PI / 180;
const lin = (r: number, g: number, b: number) => new THREE.Color().setRGB(r, g, b, THREE.LinearSRGBColorSpace);
/** An sRGB hex, as the game's hex() reads it: three.js converts it to linear. */
const hex = (h: string) => new THREE.Color(h);
const NEON = {
  magenta: hex("#ff2fb4"), pink: hex("#ff5a8a"), cyan: hex("#22e6ff"), amber: hex("#ffb02e"),
  lantern: hex("#ff7a22"), red: hex("#ff3b30"), violet: hex("#8a4dff"),
};
const yaw = (deg: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), deg * DEG);
const pitch = (deg: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), deg * DEG);

// --- renderer, scene, camera ---------------------------------------------------
const renderer = new THREE.WebGPURenderer({ antialias: false });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.AgXToneMapping; // the look: toneMapping agx
renderer.toneMappingExposure = 1; // autoExposure false, exposure 1
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);
await renderer.init();
THREE.RectAreaLightNode.setLTC(RectAreaLightTexturesLib.init());

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 600);
const placeCamera = (seconds: number) => {
  const { eye, target } = cameraAt(seconds);
  camera.position.set(...eye);
  camera.lookAt(...target);
};
placeCamera(0);

// --- the air at rain, spring, night (air.ts with rain 1, spring 1, dawn 0) --
const SPRING = { r: 1.0, g: 0.86, b: 0.96 }, HAZE = 0.9;
const tint = (r: number, g: number, b: number) => lin(r * SPRING.r, g * SPRING.g, b * SPRING.b);
const SKY = { zenith: tint(0.06, 0.034, 0.12), horizon: tint(0.3, 0.11, 0.36), ground: lin(0.01, 0.008, 0.015) };
const FOG = { color: tint(0.14, 0.055, 0.21), density: 0.0045 * HAZE, heightDensity: 0.004 * HAZE, height: 2, falloff: 0.05, scattering: 0.6, distance: 60 };

// The sky: og.Sky's zenith, horizon and ground colours as a gradient behind
// the scene, and the image-based ambient light from the same gradient
// (RenderSettings.environmentIntensity 0.25).
const skyAt = Fn(([dir]: [any]) => {
  const up = dir.y;
  const above = mix(color(SKY.horizon), color(SKY.zenith), pow(max(up, 0), 0.5));
  return mix(color(SKY.ground), above, smoothstep(-0.02, 0.02, up));
});
scene.backgroundNode = skyAt(positionWorldDirection);
{
  const w = 128, h = 64, data = new Float32Array(w * h * 4);
  const lerp = (a: THREE.Color, b: THREE.Color, t: number) => a.clone().lerp(b, t);
  for (let y = 0; y < h; y++) {
    const up = Math.cos(((y + 0.5) / h) * Math.PI);
    const above = lerp(SKY.horizon, SKY.zenith, Math.pow(Math.max(up, 0), 0.5));
    const t = Math.min(1, Math.max(0, (up + 0.02) / 0.04)), s = t * t * (3 - 2 * t);
    const c = lerp(SKY.ground, above, s);
    for (let x = 0; x < w; x++) data.set([c.r, c.g, c.b, 1], (y * w + x) * 4);
  }
  const env = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
  env.mapping = THREE.EquirectangularReflectionMapping;
  env.colorSpace = THREE.LinearSRGBColorSpace;
  env.needsUpdate = true;
  scene.environment = env;
  scene.environmentIntensity = 0.25;
}
// Distance fog, exponential per metre as og.Fog's density (three.js's
// FogExp2 squares it); its height fog is in the lit volume below.
scene.fogNode = fog(color(FOG.color), float(1).sub(exp(positionView.length().mul(-FOG.density))));

// The moon: a weak blue directional light with cascaded shadows (three
// cascades over the default 200 m, maps 2048).
const moon = new THREE.DirectionalLight(lin(0.55, 0.6, 1), 0.08);
moon.position.set(0.3, 0.8, 0.5).multiplyScalar(100);
moon.castShadow = true;
moon.shadow.mapSize.set(2048, 2048);
moon.shadow.camera.near = 1;
moon.shadow.camera.far = 400;
Object.assign(moon.shadow.camera, { left: -200, right: 200, top: 200, bottom: -200 });
moon.shadow.shadowNode = new CSMShadowNode(moon, { cascades: 3, maxFar: 200, mode: "practical" });
scene.add(moon, moon.target);
// The dawn sun, low over the towers: off at night (intensity 0), but there
// with its shadow cascades, as in the game (air.ts buildAir).
const dawnSun = new THREE.DirectionalLight(lin(1, 0.62, 0.45), 0);
dawnSun.position.set(0.25, 0.16, -1).normalize().multiplyScalar(100);
dawnSun.castShadow = true;
dawnSun.shadow.mapSize.set(2048, 2048);
dawnSun.shadow.camera.near = 1;
dawnSun.shadow.camera.far = 400;
Object.assign(dawnSun.shadow.camera, { left: -200, right: 200, top: 200, bottom: -200 });
dawnSun.shadow.shadowNode = new CSMShadowNode(dawnSun, { cascades: 3, maxFar: 200, mode: "practical" });
scene.add(dawnSun, dawnSun.target);

// --- loading -----------------------------------------------------------------
const ktx2 = new KTX2Loader().setTranscoderPath("./basis/").detectSupport(renderer);
const gltfLoader = new GLTFLoader().setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);
const loadModel = (name: string) => gltfLoader.loadAsync(`./content/models/${name}.glb`);
const loadTexture = (name: string, srgb: boolean) => ktx2.loadAsync(`./content/textures/${name}.ktx2`).then((t) => {
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
});
const [models, textures] = await Promise.all([
  Promise.all(["stall", "block-a", "block-b", "gate", "lantern", "courier", "bike", "ped_a", "ped_b", "ped_c"].map(async (n) => [n, await loadModel(n)] as const)).then((all) => Object.fromEntries(all)),
  Promise.all([
    ["setts", "cobblestone_01_diff_1k", true], ["settsNormal", "cobblestone_01_nor_gl_1k", false], ["settsArm", "cobblestone_01_arm_1k", false],
    ["concrete", "brushed_concrete_diff_1k", true], ["concreteNormal", "brushed_concrete_nor_gl_1k", false], ["concreteArm", "brushed_concrete_arm_1k", false],
    ["windows", "tower-windows", true], ["ring", "signs/ring", true], ["bowl", "signs/bowl", true], ["chevrons", "signs/chevrons", true], ["triangle", "signs/triangle", true],
  ].map(async ([k, n, s]) => [k, await loadTexture(n as string, s as boolean)] as const)).then((all) => Object.fromEntries(all) as Record<string, THREE.Texture>),
]);
/** A texture with its own repeat and offset (og's per-map repeat on a shared texture). */
const tiled = (t: THREE.Texture, rx: number, ry: number, ox = 0, oy = 0) => {
  const c = t.clone();
  c.repeat.set(rx, ry);
  c.offset.set(ox, oy);
  return c;
};
const shadows = (o: THREE.Object3D, cast: boolean) => o.traverse((m) => { if ((m as THREE.Mesh).isMesh) { m.castShadow = cast; m.receiveShadow = true; } });

// --- the set (set.ts) --------------------------------------------------------
const quad = new THREE.PlaneGeometry(1, 1);
const box = new THREE.BoxGeometry(1, 1, 1);
const sphere = new THREE.SphereGeometry(0.5, 24, 16);
const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardNodeMaterial({ roughness: 1, metalness: 0, ...p });
function place(geometry: THREE.BufferGeometry, material: THREE.Material, at: [number, number, number], size: [number, number, number] = [1, 1, 1], turn?: THREE.Quaternion, shadow = true, parent: THREE.Object3D = scene): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(...at);
  m.scale.set(...size);
  if (turn) m.quaternion.copy(turn);
  m.castShadow = shadow;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
/** A neon sign: the glyph glowing on a panel, and the rect light it throws a hand in front of it. */
function sign(art: string, at: [number, number, number], w: number, h: number, c: THREE.Color, facing: number, power = 3.5) {
  const panel = std({ color: lin(0.02, 0.02, 0.02), emissive: lin(1, 1, 1), emissiveMap: textures[art]!, emissiveIntensity: power * 2.2, roughness: 0.4 });
  const e = place(quad, panel, at, [w, h, 1], yaw(facing), false);
  const light = new THREE.RectAreaLight(c, power * 1.2, w, h);
  light.position.set(0, 0, 0.05);
  light.quaternion.copy(yaw(180));
  e.add(light);
}
/** A paper lantern at its hook and the warm point light inside it. */
function lantern(x: number, y: number, z: number, c: THREE.Color = NEON.lantern, size = 0.55) {
  const k = size / 1.32;
  const e = models.lantern.scene.clone();
  e.position.set(x, y, z);
  e.scale.setScalar(k);
  shadows(e, false);
  const light = new THREE.PointLight(c, 7, 9, 2);
  e.add(light);
  scene.add(e);
}
{
  const arm = textures.concreteArm!;
  const span = [3, 1] as const;
  const concrete = std({
    map: tiled(textures.concrete!, ...span), color: lin(0.45, 0.44, 0.47), normalMap: tiled(textures.concreteNormal!, ...span),
    aoMap: tiled(arm, ...span), roughnessMap: tiled(arm, ...span), roughness: 1,
  });
  const tower = std({ color: lin(0.02, 0.02, 0.03), roughness: 0.5, metalness: 0.4 });

  // The street: 28 x 90 m of setts, three metres a tile.
  const tile = [28 / 3, 90 / 3] as const;
  const setts = std({
    map: tiled(textures.setts!, ...tile), color: lin(0.55, 0.55, 0.6), normalMap: tiled(textures.settsNormal!, ...tile),
    aoMap: tiled(textures.settsArm!, ...tile), roughnessMap: tiled(textures.settsArm!, ...tile), roughness: 1, metalness: 0,
  });
  place(quad, setts, [0, 0, -30], [28, 90, 1], pitch(-90), false);

  const model = (name: string, scale: number, half: number, x: number, z: number, front: number) => {
    const e = models[name].scene.clone();
    e.position.set(x, half * scale, z);
    e.quaternion.copy(yaw(front));
    e.scale.setScalar(scale);
    shadows(e, true);
    scene.add(e);
  };
  const blockA = (x: number, z: number, front: number, scale = 11.6) => model("block-a", scale, 0.95, x, z, front);
  const blockB = (x: number, z: number, front: number, scale = 8.4) => model("block-b", scale, 0.95, x, z, front);

  model("stall", 2.3, 0.615, -3.7, 3.1, 78);
  blockA(-11.4, -1.5, 90);
  blockB(-8.6, -14, 90);
  blockA(-9.6, -27, 90, 10.2);
  // (The steam off the stall's pots is og particles: not drawn here.)
  const strip = new THREE.RectAreaLight(NEON.amber, 4, 1.6, 3.6);
  strip.position.set(-3.6, 2.35, 3.1);
  strip.quaternion.copy(pitch(-90));
  scene.add(strip);
  const spill = new THREE.SpotLight(NEON.amber, 40, 14, 0.75, 0.7, 2);
  spill.position.set(-2.0, 2.3, 3.6);
  spill.target.position.set(0.9, 0.9, 4.7);
  spill.castShadow = true;
  spill.shadow.mapSize.set(512, 512);
  scene.add(spill, spill.target);
  lantern(-2.1, 2.7, 4.3, NEON.lantern, 0.42);
  lantern(-2.3, 2.45, 1.9, NEON.lantern, 0.45);
  lantern(-2.9, 2.6, -1.2, NEON.lantern, 0.4);

  blockB(9.4, -2.5, -90);
  blockA(9.6, -15, -90);
  blockB(8.6, -27.5, -90, 9.2);
  lantern(4.2, 3.4, -0.5, NEON.red, 0.6);
  lantern(3.6, 6.6, -9, NEON.red, 0.5);
  sign("ring", [3.75, 8.2, -11.5], 1.8, 3.6, NEON.cyan, -90);
  sign("bowl", [4.55, 5.4, -4.5], 1.6, 1.6, NEON.magenta, -90);
  sign("chevrons", [-5.55, 8.6, -4], 2.1, 4.2, NEON.magenta, 90);
  sign("ring", [-3.75, 6.6, -12.5], 1, 2, NEON.cyan, 90);
  sign("triangle", [-3.7, 4.3, -17.2], 1.6, 1.6, NEON.amber, 60);

  place(box, concrete, [0, 5.6, -20.5], [9, 0.7, 2.2]);
  {
    const gate = models.gate.scene.clone();
    gate.position.set(0, 2.16, -24);
    gate.scale.setScalar(3.37);
    shadows(gate, true);
    scene.add(gate);
  }

  const towers: [number, number, number, number, number, THREE.Color][] = [
    [-3, -95, 11, 88, 11, NEON.magenta], [-21, -78, 12, 56, 12, NEON.cyan], [17, -84, 11, 66, 11, NEON.violet],
    [7, -135, 14, 132, 14, NEON.cyan], [-36, -120, 16, 92, 16, NEON.magenta], [34, -112, 15, 84, 15, NEON.pink],
    [-13, -170, 16, 150, 16, NEON.violet], [24, -180, 18, 165, 18, NEON.magenta], [52, -150, 16, 110, 16, NEON.cyan], [-55, -160, 18, 120, 18, NEON.pink],
  ];
  towers.forEach(([x, z, w, h, d, c], i) => {
    const slab = std({ color: lin(0.02, 0.02, 0.03), roughness: 0.5, metalness: 0.4, emissive: lin(1, 1, 1), emissiveMap: tiled(textures.windows!, w / 28, h / 30, i * 0.37, i * 0.21), emissiveIntensity: 0.9 });
    place(box, slab, [x, h / 2, z], [w, h, d], undefined, false);
    const edge = std({ color: lin(0, 0, 0), emissive: c, emissiveIntensity: 3 });
    place(box, edge, [x - w * 0.3, h * 0.55, z + d / 2 + 0.1], [0.5, h * 0.5, 0.1], undefined, false);
    place(box, edge, [x, h * 0.82, z + d / 2 + 0.1], [w * 0.7, 0.6, 0.1], undefined, false);
  });

  ([[2.5, 19, -40], [-1.5, 14, -52], [5, 11, -34]] as const).forEach(([x, y, z], i) => {
    const craft = place(sphere, tower, [x, y, z], [3.4, 0.7, 2.2], undefined, false);
    const lamp = std({ color: lin(0, 0, 0), emissive: i === 1 ? NEON.amber : NEON.cyan, emissiveIntensity: 10 });
    place(sphere, lamp, [0, -0.5, 0.3], [0.12, 0.3, 0.16], undefined, false, craft);
  });
}

// --- the cast (cast.ts) --------------------------------------------------------
const mixers: { mixer: THREE.AnimationMixer; action: THREE.AnimationAction; at: (t: number) => number }[] = [];
const clipOf = (gltf: any, name: string) => {
  const c = gltf.animations.find((a: THREE.AnimationClip) => a.name === name);
  if (!c) throw new Error(`no clip ${name} in ${gltf.animations.map((a: THREE.AnimationClip) => a.name).join(", ")}`);
  return c as THREE.AnimationClip;
};
/** One skinned instance playing `clip` at the time `at(seconds into the path)`. */
function play(root: THREE.Object3D, clip: THREE.AnimationClip, at: (t: number) => number) {
  const mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(clip);
  action.play();
  mixers.push({ mixer, action, at });
}
// The courier, three-quarter back to the camera, his idle clip played to and
// fro over its standing stretch at a third of its speed (Stand).
const STAND_FROM = 3.3, STAND_FOR = 1.2, IDLE_LENGTH = 4;
{
  const courier = SkeletonUtils.clone(models.courier.scene);
  courier.position.set(0.75, 0, 5.0);
  courier.quaternion.copy(yaw(165));
  shadows(courier, true);
  const pack = new THREE.PointLight(NEON.cyan, 0.8, 4, 2);
  pack.position.set(0, 1.25, -0.55);
  courier.add(pack);
  scene.add(courier);
  play(courier, clipOf(models.courier, "Idle"), (t) => {
    const u = (t * 0.35) % (2 * STAND_FOR);
    const along = u < STAND_FOR ? u : 2 * STAND_FOR - u;
    return (STAND_FROM + along) % IDLE_LENGTH;
  });

  const bike = models.bike.scene.clone();
  bike.position.set(2.7, 0.78, 3.5);
  bike.quaternion.copy(yaw(28));
  bike.scale.setScalar(1.65);
  shadows(bike, true);
  const under = new THREE.PointLight(NEON.cyan, 4, 4, 2);
  under.position.set(0, -0.3, 0);
  bike.add(under);
  scene.add(bike);
}
// The walkers: each a few seconds out of step, walking the alley at 1.25 m/s
// and wrapping at its ends (Walk).
const WALKERS = [
  { model: "a", x: -1.3, z: -4.5, towards: -1, offset: 0.0 },
  { model: "b", x: 0.5, z: -8.0, towards: 1, offset: 0.5 },
  { model: "c", x: -0.5, z: -10.5, towards: -1, offset: 0.9 },
  { model: "a", x: 1.7, z: -13.0, towards: 1, offset: 0.3 },
  { model: "b", x: -2.0, z: -15.5, towards: -1, offset: 1.1 },
  { model: "c", x: 2.6, z: -6.2, towards: 1, offset: 0.0, stands: true },
  { model: "a", x: 0.2, z: -18.5, towards: 1, offset: 0.7 },
  { model: "c", x: -0.9, z: -21.5, towards: -1, offset: 0.2 },
] as const;
const PACE = 1.25, ALLEY_NEAR = -3, ALLEY_FAR = -26;
const walkers: { root: THREE.Object3D; z: number; towards: number }[] = [];
for (const w of WALKERS) {
  const gltf = models[`ped_${w.model}`];
  const root = SkeletonUtils.clone(gltf.scene);
  root.position.set(w.x, 0, w.z);
  root.quaternion.copy(yaw(w.towards > 0 ? 0 : 180));
  shadows(root, true);
  scene.add(root);
  const stands = "stands" in w && w.stands;
  const clip = stands ? (gltf.animations.find((a: THREE.AnimationClip) => a.name === "Stand_and_Chat") ?? clipOf(gltf, "Idle")) : clipOf(gltf, "Walk_with_Umbrella_inplace");
  play(root, clip, (t) => (t + w.offset) % clip.duration);
  if (!stands) walkers.push({ root, z: w.z, towards: w.towards });
}
const walk = (t: number) => {
  const span = ALLEY_NEAR - ALLEY_FAR;
  for (const w of walkers) {
    // The game steps z by PACE * dt and wraps at the ends; the same as a closed form of t.
    const z = w.z + w.towards * PACE * t;
    w.root.position.z = ALLEY_FAR + ((((z - ALLEY_FAR) % span) + span) % span);
  }
};

// --- the lit fog (og.Fog volumetric: density, height fog, scattering 0.6, 60 m) --
const VOLUME_LAYER = 10;
const volume = new THREE.VolumeNodeMaterial();
volume.steps = 24;
volume.offsetNode = bayer16(screenCoordinate);
// The fog's scattering coefficient per metre (density, thickened below its
// height, times the albedo 0.6) with an isotropic phase (1 / 4 pi: three.js's
// volumetric model has no phase function), times 100 (the model scales what
// a step scatters by 0.01).
volume.scatteringNode = Fn(({ positionRay }: { positionRay: any }) => {
  const above = max(positionRay.y.sub(FOG.height), 0);
  return float(FOG.density).add(float(FOG.heightDensity).mul(exp(above.mul(-FOG.falloff)))).mul((FOG.scattering * 100) / (4 * Math.PI));
});
const fogBox = new THREE.Mesh(new THREE.BoxGeometry(FOG.distance, 30, FOG.distance * 2), volume);
fogBox.position.set(0, 15, -FOG.distance + 10);
fogBox.layers.disableAll();
fogBox.layers.enable(VOLUME_LAYER);
scene.add(fogBox);
scene.traverse((o) => { if ((o as THREE.Light).isLight) o.layers.enable(VOLUME_LAYER); });

// --- the frame (the look: looks/night-shift.ogt over cinematic-realism) -------
const pipeline = new THREE.RenderPipeline(renderer);
pipeline.outputColorTransform = false;
// A depth and normal prepass for the ambient occlusion and the reflections.
const prePass = pass(scene, camera);
prePass.transparent = false;
prePass.setMRT(mrt({ output: packNormalToRGB(normalView), metalrough: vec2(metalness, roughness) }));
prePass.getTexture("output").type = THREE.UnsignedByteType;
prePass.getTexture("metalrough").type = THREE.UnsignedByteType;
const preDepth = prePass.getTextureNode("depth");
const preNormal = sample((uv: any) => unpackRGBToNormal(prePass.getTextureNode("output").sample(uv)));
const preMetalRough = prePass.getTextureNode("metalrough");
// Ambient occlusion on the ambient light only (aoRadius 0.6 m, full resolution).
const aoPass = ao(preDepth, preNormal, camera);
aoPass.radius.value = 0.6;
aoPass.resolutionScale = 1;
// The scene, 4x multisampled (msaaSamples 4).
const scenePass = pass(scene, camera, { samples: 4 });
scenePass.contextNode = builtinAOContext(aoPass.getTextureNode().sample(screenUV).r);
const sceneColor = scenePass.getTextureNode("output");
// Screen-space reflections at half resolution, out to 60 m.
const ssrPass = ssr(sceneColor, preDepth, preNormal, { metalnessNode: preMetalRough.r, roughnessNode: preMetalRough.g, camera } as any);
ssrPass.maxDistance.value = 60;
ssrPass.resolutionScale = 0.5;
// The lit fog at a quarter resolution, blurred and added.
const volumeLayer = new THREE.Layers();
volumeLayer.disableAll();
volumeLayer.enable(VOLUME_LAYER);
volume.depthNode = scenePass.getTextureNode("depth").sample(screenUV);
const volumePass = pass(scene, camera, { depthBuffer: false });
volumePass.setLayers(volumeLayer);
volumePass.setResolutionScale(0.25);
const lit = sceneColor.add(ssrPass.rgb).add(gaussianBlur(volumePass, 0.6));
// Bloom (0.4 over a threshold of 1.1, knee 0.5).
const bloomPass = bloom(lit, 0.4, 0, 1.1);
bloomPass.smoothWidth.value = 0.5;
// Chromatic aberration of 0.5 px at the corners at 720p: ChromaticAberrationNode
// moves a corner's red and blue by about 0.019 x strength of the frame.
const hdr = chromaticAberration(lit.add(bloomPass), uniform(0.036), vec2(0.5, 0.5), uniform(1));
// Tone mapping (AgX), then the grade in display colour: saturation 0.2,
// film grain 0.03, the vignette (0.3, radius 0.55, smoothness 0.45).
const display = saturation(renderOutput(hdr), 1.2);
const grained = film(display, uniform(0.03));
const corner = screenUV.sub(0.5).length().div(Math.SQRT1_2);
const vignette = float(1).sub(smoothstep(0.55, 1.0, corner).mul(0.3));
pipeline.outputNode = vec4(grained.rgb.mul(vignette), 1);

// --- the clock and the benchmark's hooks ----------------------------------------
let startedAt = 0;
const pathSeconds = () => (startedAt ? (performance.now() - startedAt) / 1000 : 0);
Object.assign(window, {
  __benchStart: () => { startedAt = performance.now(); },
  __benchPathSeconds: pathSeconds,
});
let marked = false;
function frame() {
  const t = pathSeconds();
  placeCamera(Math.min(t, PATH_SECONDS));
  walk(t);
  for (const m of mixers) {
    m.action.time = m.at(t);
    m.mixer.update(0);
  }
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
