// The Last Light: a wanderer on a cliff path, a lighthouse on its headland,
// the sun going down into a swelling sea.
//
// engine-bench: the camera flies the benchmark's path (camera-path.ts),
// BenchDisplay records what automatic quality draws for the harness, and
// bench.ts holds a path time or switches a feature off when the harness asks.
import { defineSystem, og } from "@origingame/engine";
import type { World } from "@origingame/engine";
import { Climate, Seasons, buildClimate, climateCommands, climateHelp } from "./climate.ts";
import { buildCoast } from "./coast.ts";
import { Beam, buildLight } from "./lighthouse.ts";
import { buildSky } from "./sky.ts";
import { buildWanderer } from "./wanderer.ts";
import { cameraAt } from "./camera-path.ts";
import { BenchSwitches, benchRender, pathSeconds } from "./bench.ts";
import { CAMERA } from "./layout.ts";
import { must } from "./must.ts";

function build(world: World): void {
  const coast = buildCoast(world);
  buildWanderer(world, coast);
  buildLight(world, coast);
  buildSky(world);
  buildClimate(world);

  const cam = must(world.resource(og.Camera));
  cam.position = { x: CAMERA.x, y: coast.heightAt(CAMERA.x, CAMERA.z) + CAMERA.eye, z: CAMERA.z };
  cam.quaternion = og.transform.lookAt(cam.position, { x: CAMERA.lookX, y: cam.position.y - CAMERA.drop, z: CAMERA.lookZ });
  cam.fov = CAMERA.fov;
  cam.far = 6000;
}

/** Flies the camera along the benchmark's path, by simulation time. */
const CameraPath = defineSystem("CameraPath", { writes: [og.Camera] }, (_q, time, world) => {
  const { eye, target } = cameraAt(pathSeconds(time.tick, time.dt));
  const cam = must(world.resource(og.Camera));
  cam.position = { x: eye[0], y: eye[1], z: eye[2] };
  cam.quaternion = og.transform.lookAt(cam.position, { x: target[0], y: target[1], z: target[2] });
});

/**
 * engine-bench: what automatic quality draws, for the harness (hook.js
 * installs globalThis.__bench in this Worker). One row each time the
 * render scale or the preset steps change: [epoch ms, tick, render scale,
 * preset steps, scene width, scene height].
 */
const BenchDisplay = defineSystem("BenchDisplay", {}, (_q, time, world) => {
  const host = globalThis as { __bench?: { display?: number[][] }; performance?: { timeOrigin: number; now(): number } };
  const bench = host.__bench;
  if (!bench || !host.performance) return;
  const d = og.render.display(world);
  if (!d) return;
  const rows = (bench.display ??= []);
  const last = rows[rows.length - 1];
  if (!last || last[2] !== d.renderScale || last[3] !== d.presetSteps || last[4] !== d.sceneWidth) {
    rows.push([host.performance.timeOrigin + host.performance.now(), time.tick, // og-ok: the harness's record, not the world
      d.renderScale, d.presetSteps, d.sceneWidth, d.sceneHeight]);
  }
});

export default og.game({
  start: build,
  resources: [Climate],
  systems: [Seasons, Beam, CameraPath, BenchDisplay, BenchSwitches],
  ...benchRender(),
  commands: climateCommands,
  commandHelp: climateHelp,
});
