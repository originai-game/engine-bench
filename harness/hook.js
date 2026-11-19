// Injected into the page and into every Worker before their own scripts run
// (harness/run.ts), the same for every engine. It records, on one clock
// (epoch milliseconds, performance.timeOrigin + performance.now()):
//
// - each frame: the moment a canvas's next texture is taken
//   (GPUCanvasContext.getCurrentTexture returning a new texture), with the
//   texture's size, so the interval between two is the frame time and the
//   size is the resolution actually drawn;
// - while `trackDone` is on (the harness turns it off before the camera
//   path starts): when the GPU finished each frame, from
//   queue.onSubmittedWorkDone asked after every submit of that frame (the
//   last to resolve is the frame's completion, when it can be presented).
//
// A paused Worker does not have the WebGPU interfaces yet when the hook is
// evaluated, so it retries on the event loop until they are there (before
// any frame: a frame needs them).
(function install(tries) {
  if (globalThis.__bench) return;
  if (typeof GPUCanvasContext === "undefined") {
    if (tries < 2000) setTimeout(() => install(tries + 1), tries < 50 ? 0 : 5);
    return;
  }
  const now = () => performance.timeOrigin + performance.now();
  // frames: [acquired, width, height, done]
  const bench = (globalThis.__bench = { frames: [], trackDone: true, where: typeof document === "undefined" ? "worker" : "page" });
  const take = GPUCanvasContext.prototype.getCurrentTexture;
  let last = null;
  GPUCanvasContext.prototype.getCurrentTexture = function () {
    const t = take.call(this);
    if (t !== last) {
      last = t;
      if (bench.frames.length < 200000) bench.frames.push([now(), t.width, t.height, 0]);
    }
    return t;
  };
  const submit = GPUQueue.prototype.submit;
  GPUQueue.prototype.submit = function (buffers) {
    const r = submit.call(this, buffers);
    const frame = bench.frames[bench.frames.length - 1];
    if (bench.trackDone && frame) {
      this.onSubmittedWorkDone().then(() => {
        const first = bench.frames[0][3] === 0;
        frame[3] = Math.max(frame[3], now());
        // Tells the harness which context draws (it reads the record from there).
        if (first) console.debug("__bench:first-done");
      });
    }
    return r;
  };
})(0);
