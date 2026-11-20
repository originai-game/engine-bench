// engine-bench: what the harness asks of this run, through
// globalThis.__benchConfig, which it sets in this Worker before the game's
// first line (harness/features.ts). A player's run has none, so the game
// is the showcase's.
//
//   hold   seconds into the camera path to hold the camera and the beam at
//   off    features to switch off, each the og record that draws it:
//          clouds     og.Clouds
//          exposure   og.RenderSettings.autoExposure (the exposure Seasons sets stays)
//          sky        og.PhysicalSky (og.DayNight's gradient sky draws instead)
//          taa        RenderOptions.antialias off (one sample per pixel)
//          cloth      the cloak's og.Garment
//          rope       the lantern cord's og.Rope
//          wind       og.TerrainScatter.sway on the five plant layers
//          sea        og.Water
//          seafx      og.Water's spray and foam streaks
//          grass      og.Grass
//          scatter    the five og.TerrainScatter layers
//   pin    automatic quality off, render scale 1 (a feature's cost at one resolution)
import { defineSystem, og } from "@origingame/engine";
import type { Antialias } from "@origingame/engine";
import { must } from "./must.ts";

interface BenchConfig { hold?: number; off?: string[]; pin?: boolean }
const config = (): BenchConfig => (globalThis as { __benchConfig?: BenchConfig }).__benchConfig ?? {};

export const benchOff = (feature: string): boolean => config().off?.includes(feature) ?? false;

/** Seconds into the camera path: the held time, else the simulation's. */
export const pathSeconds = (tick: number, dt: number): number => config().hold ?? tick * dt;

/** og.game's render options: the engine's default antialiasing, or none for `off taa`. */
export const benchRender = (): { render?: { antialias: Antialias } } => (benchOff("taa") ? { render: { antialias: "off" } } : {});

const SCATTERS = ["plume-grass", "oxeye", "buttercup", "thrift", "foxglove"];

/** Applies `off` and `pin` every tick (Seasons rewrites the season's fields each switch). */
export const BenchSwitches = defineSystem("BenchSwitches", {
  writes: [og.Clouds, og.RenderSettings, og.PhysicalSky, og.Garment, og.Rope, og.TerrainScatter, og.Water, og.Grass],
}, (_q, _time, world) => {
  const c = config();
  if (!c.off?.length && !c.pin) return;
  if (c.pin) og.render.setDisplay(world, { autoQuality: false, renderScale: 1 });
  if (benchOff("clouds")) must(world.resource(og.Clouds)).enabled = false;
  if (benchOff("exposure")) must(world.resource(og.RenderSettings)).autoExposure = false;
  if (benchOff("sky")) must(world.resource(og.PhysicalSky)).enabled = false;
  const drop = (name: string, record: Parameters<typeof world.remove>[1]) => {
    const e = world.find(name);
    if (e !== null && world.get(e, record) !== null) must(world.remove(e, record));
  };
  if (benchOff("cloth")) drop("wanderer", og.Garment);
  if (benchOff("rope")) drop("lantern-cord", og.Rope);
  // The sea goes whole: Seasons sets its og.Water whenever the weather moves.
  if (benchOff("sea")) {
    const e = world.find("sea");
    if (e !== null) must(world.despawn(e));
  }
  // The grass and the scatter stay on their entities (Seasons sets their
  // fields each tick) and draw nothing.
  if (benchOff("grass")) {
    const e = world.find("coast");
    if (e !== null) must(world.set(e, og.Grass, { density: 0 }));
  }
  if (benchOff("scatter")) for (const s of SCATTERS) {
    const e = world.find(s);
    if (e !== null && world.get(e, og.TerrainScatter) !== null) must(world.set(e, og.TerrainScatter, { distance: 0 }));
  }
  if (benchOff("wind")) for (const s of SCATTERS) {
    const e = world.find(s);
    if (e !== null && world.get(e, og.TerrainScatter) !== null) must(world.set(e, og.TerrainScatter, { sway: 0 }));
  }
  if (benchOff("seafx")) {
    const e = world.find("sea");
    if (e !== null) must(world.set(e, og.Water, { spray: 0, foamStreaks: 0 }));
  }
});
