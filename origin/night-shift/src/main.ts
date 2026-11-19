// Night Shift: a courier and a hover-bike at the mouth of a market alley.
// The set and the cast are built once (set.ts, cast.ts); air.ts runs the
// weather, the season and the time of day over them.
//
// engine-bench: the showcase as it is on origin-engine main, without its HUD
// (a UI overlay, not the 3D scene; on the 0.9.0 web host its start throws
// while the HUD's font pack is still being fetched), and with the camera
// flying the benchmark's path (camera-path.ts) from the first tick.
import { defineSystem, og } from "@origingame/engine";
import type { World } from "@origingame/engine";
import { Air, AirSystem, buildAir, SEASONS, setSeason, setTime, setWeather, TIMES, WEATHERS } from "./air.ts";
import { buildCast, Stand, Walk } from "./cast.ts";
import { buildFlora, Flora } from "./flora.ts";
import { cameraAt } from "./camera-path.ts";
import { buildSet } from "./set.ts";
import { must, v3 } from "./util.ts";

function start(world: World): void {
  buildSet(world);
  buildCast(world);
  buildFlora(world);
  buildAir(world);

  // The switches: each key steps its setting to the next, which ramps in.
  for (const [name, key, pad] of [["weather", "KeyR", "pad.x"], ["season", "KeyF", "pad.y"], ["time", "KeyT", "pad.b"]] as const) {
    must(og.input.defineAction(world, { name, kind: "button", bindings: [{ control: key }, { control: pad }] }));
  }

  const cam = must(world.resource(og.Camera));
  // Low, near the street, pitched up: the wet setts fill the lower third
  // and the towers stand over the gate.
  cam.position = v3(0, 0.7, 7);
  cam.quaternion = og.transform.lookAt(cam.position, v3(0, 5.2, -13));
  cam.fov = 62;
  cam.far = 600;
}

/** Flies the camera along the benchmark's path, by simulation time. */
const CameraPath = defineSystem("CameraPath", { writes: [og.Camera] }, (_q, time, world) => {
  const { eye, target } = cameraAt(time.tick * time.dt);
  const cam = must(world.resource(og.Camera));
  cam.position = v3(eye[0], eye[1], eye[2]);
  cam.quaternion = og.transform.lookAt(cam.position, v3(target[0], target[1], target[2]));
});

/** Steps the weather, the season and the time of day on their keys. */
const Switches = defineSystem("Switches", { writes: [Air] }, (_q, _time, world) => {
  const air = must(world.resource(Air));
  if (og.input.isActionJustPressed(world, "weather")) air.weather = (air.weather + 1) % WEATHERS.length;
  if (og.input.isActionJustPressed(world, "season")) air.season = (air.season + 1) % SEASONS.length;
  if (og.input.isActionJustPressed(world, "time")) air.time = (air.time + 1) % TIMES.length;
});

export default og.game({
  tick: 60,
  seed: 1,
  look: "looks/night-shift.ogt",
  resources: [Air],
  systems: [Switches, AirSystem, Flora, Walk, Stand, CameraPath],
  commands: {
    weather: (world, args) => setWeather(world, args[0]),
    season: (world, args) => setSeason(world, args[0]),
    time: (world, args) => setTime(world, args[0]),
  },
  commandHelp: {
    weather: { usage: "<rain|storm|fog|clear|snow>", doc: "Switch the weather; it ramps over a few seconds." },
    season: { usage: "<spring|summer|autumn|winter>", doc: "Turn the season." },
    time: { usage: "<night|dawn>", doc: "Break the dawn, or go back to night." },
  },
  start,
});
