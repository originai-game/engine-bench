# The Last Light in Chrome (WebGPU): 2026-11-20

Mac16,8, Apple M4 Pro, macOS 27.2 26B5091g; Chrome/158.0.8127.36; canvas 2560 x 1440. One cold run per engine.

| Engine | Download (brotli) | Cold first frame | Frame time median | Frame time p95 | Frames on the path | Path wall time |
|---|---|---|---|---|---|---|
| Origin Engine (main 3cdf5081e) | 53.24 MB (100 requests) | 5149 ms | 99.7 ms | 213.8 ms | 377 | 37.4 s |
| three.js r187 WebGPURenderer | 43.75 MB (27 requests) | 4008 ms | 38.6 ms | 97.5 ms | 361 | 20.1 s |

| Engine | First canvas frame (any content) | Page's first-frame mark | Frames drawn before the first full one | Mean frame time | Longest frame |
|---|---|---|---|---|---|
| Origin Engine (main 3cdf5081e) | 1632 ms | 3122 ms | 20 | 99.3 ms | 262.5 ms |
| three.js r187 WebGPURenderer | 4008 ms | 3841 ms | 0 | 55.4 ms | 332.1 ms |

Origin Engine (main 3cdf5081e)'s render scale over the path (automatic quality, its default; the path's own clock): 1.0 from 0.0 s, 0.9 from 4.4 s, 0.8 from 7.2 s, 0.7 from 9.8 s, 0.6 from 12.6 s, 0.5 from 15.0 s, 0.5 and the graphics preset 1 step down from 18.7 s. Lowest 0.5; below 0.75 for 10.2 s of the 20 s path (51%). Every step is in frames.json (`display`).

Load average (1, 5, 15 min) when each run started, and the highest one-minute load while it ran: origin { 1.62 1.62 1.91 }, at most 2.44; three { 1.11 1.50 1.83 }, at most 1.37.
No run was disturbed.

![The cover shot, the path's last frame, from each engine (left to right: Origin Engine (main 3cdf5081e), three.js r187 WebGPURenderer)](cover-side-by-side.png)
