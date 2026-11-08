#!/usr/bin/env node
// Captures a reproducible recruiter-facing demo of Toad Live.
//
// This NEVER touches the real Fly production app or database. It builds
// the app locally (the same `pnpm build` CI/Fly use), boots it against a
// brand-new throwaway SQLite file under a scratch directory, drives it
// through two independent Playwright browser contexts exactly the way a
// real resident's browser would (real HTTP requests to the real API, no
// demo-only hooks in application code), records video per session, and
// composes the result with ffmpeg. All scratch state and the throwaway DB
// are removed before the script exits, including on failure.
//
// Usage: node scripts/portfolio/capture-demo.mjs
// Requires devDependencies installed once in THIS directory
// (`cd scripts/portfolio && npm install`) — intentionally not part of the
// app's own package.json, since this tooling never ships with the app.

import { chromium } from "./node_modules/playwright/index.mjs";
import ffmpegPath from "./node_modules/ffmpeg-static/index.js";
import ffprobePkg from "./node_modules/ffprobe-static/index.js";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, rm, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const OUT_DIR = join(REPO_ROOT, "docs", "portfolio", "demo");
const PORT = 8099;
const BASE = `http://localhost:${PORT}`;
const ffprobePath = ffprobePkg.path;

const VIEWPORT = { width: 1280, height: 800 };
const HALF = { width: 640, height: 800 };

function run(cmd, args, opts = {}) {
  execFileSync(cmd, args, { stdio: "inherit", cwd: REPO_ROOT, ...opts });
}

function ffmpeg(args) {
  execFileSync(ffmpegPath, ["-y", "-hide_banner", "-loglevel", "error", ...args], { stdio: "inherit" });
}

async function waitForServer(url, timeoutMs = 20_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`server never answered at ${url}`);
}

async function getJson(page, path) {
  return page.evaluate((p) => fetch(p).then((r) => r.json()), path);
}

async function patch(page, path, body) {
  const current = await getJson(page, path);
  const fullBody = { ...body, ifVersion: current.version };
  return page.evaluate(
    async ({ path, fullBody }) => {
      const res = await fetch(path, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(fullBody),
      });
      return { status: res.status, body: await res.json() };
    },
    { path, fullBody },
  );
}

async function selectFacility(page, facility) {
  await page.click(`.facility-tab[data-facility="${facility}"]`);
  await page.waitForTimeout(700);
}

async function pseudonymOf(page) {
  return page.locator(".identity strong").innerText();
}

async function resetFacilities(page) {
  await patch(page, "/api/aa-room", { occupancy: "empty", activities: [] });
  for (const seat of ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"]) {
    await patch(page, `/api/rat-room/${seat}`, { occupancy: "empty" });
  }
}

async function listFiles(dir) {
  const entries = await readdir(dir);
  return entries.map((f) => join(dir, f));
}

// Playwright's own `chromium.launch()` expects the exact browser build its
// package.json pins to be pre-downloaded (`npx playwright install`). This
// environment already has one or more Chromium builds cached from earlier
// work in this repo — reuse whichever one is actually present rather than
// re-downloading, so this script works offline and doesn't silently grow
// the machine's browser cache every run.
async function launchChromium() {
  const cacheRoot = join(process.env.HOME ?? "", ".cache", "ms-playwright");
  let candidates = [];
  try {
    candidates = (await readdir(cacheRoot)).filter((d) => d.startsWith("chromium-"));
  } catch {
    // fall through to default launch below
  }
  for (const dir of candidates.sort().reverse()) {
    const exe = join(cacheRoot, dir, "chrome-linux64", "chrome");
    try {
      await stat(exe);
      return chromium.launch({ executablePath: exe });
    } catch {
      // try the next candidate
    }
  }
  return chromium.launch();
}

function sec(ms) {
  return (ms / 1000).toFixed(2);
}

async function main() {
  console.log("== Toad Live demo capture ==");

  const scratch = await mkdtemp(join(tmpdir(), "toad-live-demo-"));
  const dbPath = join(scratch, "toadlive.db");
  const videoDirA = join(scratch, "video-a");
  const videoDirB = join(scratch, "video-b");
  const work = join(scratch, "compose");
  await mkdir(videoDirA, { recursive: true });
  await mkdir(videoDirB, { recursive: true });
  await mkdir(work, { recursive: true });
  await mkdir(OUT_DIR, { recursive: true });

  let serverProc;
  let browser;

  const cleanup = async () => {
    if (browser) await browser.close().catch(() => {});
    if (serverProc && !serverProc.killed) {
      serverProc.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 300));
    }
    await rm(scratch, { recursive: true, force: true });
  };
  process.on("SIGINT", () => cleanup().then(() => process.exit(130)));

  const t = {}; // scene timestamps, ms offset from recordingStart

  try {
    console.log("-- building app (pnpm build) --");
    run("pnpm", ["build"]);

    console.log(`-- starting local server on :${PORT} against a throwaway DB --`);
    serverProc = spawn("node", ["./dist/server/entry.mjs"], {
      cwd: REPO_ROOT,
      env: { ...process.env, DB_PATH: dbPath, PORT: String(PORT), HOST: "127.0.0.1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    serverProc.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));
    await waitForServer(BASE);
    console.log("   server is up");

    browser = await launchChromium();

    const contextA = await browser.newContext({ viewport: VIEWPORT, recordVideo: { dir: videoDirA, size: VIEWPORT } });
    const contextB = await browser.newContext({ viewport: VIEWPORT, recordVideo: { dir: videoDirB, size: VIEWPORT } });
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    const recordingStart = Date.now();
    const mark = (name) => {
      t[name] = Date.now() - recordingStart;
    };

    await pageA.goto(BASE, { waitUntil: "networkidle" });
    await resetFacilities(pageA);
    await pageA.reload({ waitUntil: "networkidle" });
    await pageB.goto(BASE, { waitUntil: "networkidle" });

    const pseudonymA = await pseudonymOf(pageA);
    const pseudonymB = await pseudonymOf(pageB);
    console.log(`   session A pseudonym: ${pseudonymA}`);
    console.log(`   session B pseudonym: ${pseudonymB}`);
    if (pseudonymA === pseudonymB) {
      throw new Error("sessions A and B got the same pseudonym — contexts are not actually independent");
    }

    // === Scene A — establish the product (single session) ===
    mark("sceneA_start");
    await selectFacility(pageA, "laundry");
    await pageA.waitForTimeout(1500);
    await selectFacility(pageA, "aa-room");
    await pageA.waitForTimeout(1000);
    mark("sceneA_end");

    await selectFacility(pageB, "aa-room");

    // === Scene B — real-time two-session update ===
    mark("sceneB_start");
    await pageA.check('.aa-room-report-form input[name="occupancy"][value="occupied"]');
    await pageA.waitForTimeout(300);
    await pageA.check('.aa-room-report-form input[name="activities"][value="karaoke"]');
    await pageA.waitForTimeout(300);
    await pageA.click(".aa-room-report-form button[type=submit]");
    await pageA.waitForTimeout(500);
    await pageB.waitForTimeout(2200); // SSE push lands, 3D scene + panel update with no reload
    mark("sceneB_end");

    // === Scene C — Rat Room resource mapping (single session) ===
    await selectFacility(pageA, "rat-room");
    await pageA.waitForTimeout(500);
    mark("sceneC_start");

    const seatA = pageA.locator('.rat-room-seat[data-seat="A"] .report-form');
    await seatA.locator('input[name="occupancy"][value="occupied"]').check();
    await seatA.locator("button[type=submit]").click();
    await pageA.waitForTimeout(1800);

    const seatF = pageA.locator('.rat-room-seat[data-seat="F"] .report-form');
    await seatF.locator('input[name="occupancy"][value="occupied"]').check();
    await seatF.locator("button[type=submit]").click();
    await pageA.waitForTimeout(2200);
    mark("sceneC_end");

    // === Scene D — concurrency protection (stale write -> 409) ===
    await selectFacility(pageA, "aa-room");
    await selectFacility(pageB, "aa-room");
    await pageA.waitForTimeout(500);
    await pageB.waitForTimeout(500);
    mark("sceneD_start");

    const staleVersion = await pageB.locator(".aa-room-report-form").getAttribute("data-version");

    await pageA.uncheck('.aa-room-report-form input[name="activities"][value="karaoke"]').catch(() => {});
    await pageA.check('.aa-room-report-form input[name="activities"][value="pool"]');
    await pageA.click(".aa-room-report-form button[type=submit]");
    await pageA.waitForTimeout(600);

    // Keep B's own form pinned to the version it had before A's write
    // landed, so B's submit below is a genuine stale write (a 409), not
    // silently already-synced by B's own open SSE connection.
    await pageB.evaluate((v) => {
      const form = document.querySelector(".aa-room-report-form");
      if (form) form.dataset.version = v;
    }, staleVersion);

    // B's own form never auto-syncs its radios/checkboxes from an
    // incoming SSE push (deliberately — see applyAaRoomUpdate()'s own
    // comment: a resident's in-progress selection is never overwritten by
    // someone else's report). So B's form still shows the occupancy it
    // had when B's page loaded ("empty"), and the activity checkboxes are
    // disabled until B selects "Occupied" itself — exactly what a real
    // resident filling out a stale form would do.
    await pageB.check('.aa-room-report-form input[name="occupancy"][value="occupied"]');
    pageB.once("dialog", (d) => d.accept());
    await pageB.check('.aa-room-report-form input[name="activities"][value="table-tennis"]');
    await pageB.click(".aa-room-report-form button[type=submit]");
    await pageB.waitForTimeout(1800);
    mark("sceneD_end");

    await pageA.waitForTimeout(300);
    await pageB.waitForTimeout(300);

    await pageA.close();
    await pageB.close();
    await contextA.close();
    await contextB.close();
    await browser.close();
    browser = undefined;

    const [videoAFiles, videoBFiles] = await Promise.all([listFiles(videoDirA), listFiles(videoDirB)]);
    const videoA = videoAFiles[0];
    const videoB = videoBFiles[0];
    if (!videoA || !videoB) throw new Error("expected one recorded video per session");

    console.log("-- scene timestamps (s, offset from recording start) --");
    for (const k of Object.keys(t)) console.log(`   ${k}: ${sec(t[k])}s`);

    console.log("-- composing final demo with ffmpeg --");
    const result = await composeDemo({ videoA, videoB, work, outDir: OUT_DIR, t, pseudonymA, pseudonymB });

    console.log("-- stopping local server --");
    serverProc.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 300));
    serverProc = undefined;

    console.log("== done ==");
    return result;
  } finally {
    await cleanup();
  }
}

function captionHtml(text) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;width:1280px;height:800px;background:#1b2a20;}
    .wrap{width:1280px;height:800px;display:flex;align-items:center;justify-content:center;}
    .card{font-family:-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;color:#f3efe6;font-size:44px;font-weight:700;text-align:center;padding:0 80px;}
  </style></head><body><div class="wrap"><div class="card">${text}</div></div></body></html>`;
}

async function renderCaptionPng(browser, text, outPath) {
  const page = await browser.newPage({ viewport: VIEWPORT });
  await page.setContent(captionHtml(text));
  await page.screenshot({ path: outPath });
  await page.close();
}

async function trimToClip(src, startS, endS, outPath, { scaleHalf = false } = {}) {
  const duration = Math.max(0.1, endS - startS);
  const vf = scaleHalf ? `scale=${HALF.width}:${HALF.height},setsar=1` : `scale=${VIEWPORT.width}:${VIEWPORT.height},setsar=1`;
  ffmpeg(["-ss", startS.toFixed(2), "-i", src, "-t", duration.toFixed(2), "-vf", vf, "-r", "24", "-an", outPath]);
}

async function sideBySideClip(videoA, videoB, startS, endS, outPath) {
  const duration = Math.max(0.1, endS - startS);
  ffmpeg([
    "-ss", startS.toFixed(2), "-i", videoA,
    "-ss", startS.toFixed(2), "-i", videoB,
    "-t", duration.toFixed(2),
    "-filter_complex",
    `[0:v]scale=${HALF.width}:${HALF.height},setsar=1[a];[1:v]scale=${HALF.width}:${HALF.height},setsar=1[b];[a][b]hstack=inputs=2[v]`,
    "-map", "[v]",
    "-r", "24",
    "-an",
    outPath,
  ]);
}

async function captionClip(browser, text, outPath, seconds = 1.3) {
  const png = outPath.replace(/\.mp4$/, ".png");
  await renderCaptionPng(browser, text, png);
  ffmpeg(["-loop", "1", "-t", String(seconds), "-i", png, "-vf", `scale=${VIEWPORT.width}:${VIEWPORT.height}`, "-r", "24", "-an", outPath]);
}

async function composeDemo({ videoA, videoB, work, outDir, t, pseudonymA, pseudonymB }) {
  const browser = await launchChromium();
  const clips = [];
  const addClip = (name) => clips.push(join(work, name));

  await captionClip(browser, "Two sessions &middot; one live state", join(work, "cap1.mp4"));
  addClip("cap1.mp4");

  await trimToClip(videoA, t.sceneA_start / 1000, t.sceneA_end / 1000, join(work, "sceneA.mp4"));
  addClip("sceneA.mp4");

  await captionClip(browser, "SSE update &middot; no reload", join(work, "cap2.mp4"));
  addClip("cap2.mp4");

  await sideBySideClip(videoA, videoB, t.sceneB_start / 1000, t.sceneB_end / 1000, join(work, "sceneB.mp4"));
  addClip("sceneB.mp4");

  await captionClip(browser, "Seat state &rarr; exact 3D workstation", join(work, "cap3.mp4"));
  addClip("cap3.mp4");

  await trimToClip(videoA, t.sceneC_start / 1000, t.sceneC_end / 1000, join(work, "sceneC.mp4"));
  addClip("sceneC.mp4");

  await captionClip(browser, "Stale write rejected &middot; canonical state preserved", join(work, "cap4.mp4"));
  addClip("cap4.mp4");

  await sideBySideClip(videoA, videoB, t.sceneD_start / 1000, t.sceneD_end / 1000, join(work, "sceneD.mp4"));
  addClip("sceneD.mp4");

  await browser.close();

  const listPath = join(work, "concat.txt");
  await writeFile(listPath, clips.map((c) => `file '${c}'`).join("\n"));

  const fullCombined = join(work, "full.mp4");
  ffmpeg(["-f", "concat", "-safe", "0", "-i", listPath, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", fullCombined]);

  const finalMp4 = join(outDir, "toad-live-demo.mp4");
  const finalWebm = join(outDir, "toad-live-demo.webm");
  const poster = join(outDir, "poster.png");
  ffmpeg(["-i", fullCombined, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", finalMp4]);
  ffmpeg(["-i", fullCombined, "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "34", finalWebm]);
  // Grab the poster frame from near the end of the Scene B clip itself
  // (not the full composed timeline, whose absolute timestamps shift
  // slightly run to run) — this lands reliably on the moment both
  // sessions already show "Karaoke · Occupied," rather than the opening
  // caption card or a frame mid-interaction.
  const sceneBClip = join(work, "sceneB.mp4");
  const sceneBDuration = Number(
    execFileSync(ffprobePath, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", sceneBClip])
      .toString()
      .trim(),
  );
  ffmpeg(["-i", sceneBClip, "-ss", Math.max(0, sceneBDuration - 1).toFixed(2), "-vframes", "1", poster]);

  // Short GIF: scene B (realtime) + scene C (seat mapping) only, per the
  // "keep clarity over completeness for the GIF" instruction.
  const gifSource = join(work, "gif-source.mp4");
  const gifClips = [join(work, "cap1.mp4"), join(work, "sceneB.mp4"), join(work, "cap3.mp4"), join(work, "sceneC.mp4")];
  const gifList = join(work, "gif-concat.txt");
  await writeFile(gifList, gifClips.map((c) => `file '${c}'`).join("\n"));
  ffmpeg(["-f", "concat", "-safe", "0", "-i", gifList, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", gifSource]);

  const palette = join(work, "palette.png");
  const gifWidth = 900;
  ffmpeg(["-i", gifSource, "-vf", `fps=10,scale=${gifWidth}:-1:flags=lanczos,palettegen`, palette]);
  const finalGif = join(outDir, "toad-live-demo.gif");
  ffmpeg([
    "-i", gifSource,
    "-i", palette,
    "-lavfi", `fps=10,scale=${gifWidth}:-1:flags=lanczos[x];[x][1:v]paletteuse`,
    finalGif,
  ]);

  const report = {};
  for (const [label, f] of [
    ["mp4", finalMp4],
    ["webm", finalWebm],
    ["gif", finalGif],
    ["poster", poster],
  ]) {
    const s = await stat(f);
    const probe = JSON.parse(
      execFileSync(ffprobePath, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", f]).toString(),
    );
    const vstream = probe.streams.find((s) => s.codec_type === "video");
    report[label] = {
      path: f,
      sizeKB: Math.round(s.size / 1024),
      durationS: probe.format.duration ? Number(probe.format.duration).toFixed(2) : null,
      width: vstream?.width,
      height: vstream?.height,
      fps: vstream?.avg_frame_rate,
    };
  }
  console.log(JSON.stringify(report, null, 2));
  return { report, pseudonymA, pseudonymB, timestamps: t };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
