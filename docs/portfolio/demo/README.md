# Demo capture

`toad-live-demo.mp4` / `.webm` / `.gif` and `poster.png` in this folder are generated,
not hand-recorded, by [`scripts/portfolio/capture-demo.mjs`](../../../scripts/portfolio/capture-demo.mjs).

## What it proves

- **Real-time push, not polling.** Two independent browser sessions (distinct
  server-issued pseudonyms) open AA Room side by side. Session A submits a
  report; Session B updates live over SSE with no reload.
- **Resource-level 3D mapping, not decoration.** Rat Room starts empty; two
  seats (A and F — chosen to be visually far apart) are reported occupied one
  at a time through the real report form, each showing a seated figure at
  exactly that seat's own fixed workstation while unrelated seats stay
  unchanged.
- **Concurrency protection, not last-write-wins.** Both sessions start from
  the same AA Room version; Session A changes it first; Session B's own
  stale report is rejected by the server with `409`, and its UI refreshes to
  the canonical state instead of silently overwriting Session A. (Full demo
  only — left out of the short GIF to keep it readable.)

Every interaction in the capture is driven through the real UI (clicks,
checkbox toggles, form submits) against the real API — there is no demo-only
code path in the application, and no application behaviour was changed to
make the recording possible.

## How it's captured

The script builds the real production app (`pnpm build`), starts it locally
against a throwaway SQLite database in a temp directory, drives it with two
Playwright browser contexts, records each session's video, then composes the
final outputs with `ffmpeg` (trim, side-by-side `hstack`, caption cards,
concat, and two-pass palette GIF encoding). It never touches the deployed
Fly app or the repo's own `data/toadlive.db`, and all temporary processes and
files (server, browser, scratch directory, throwaway DB) are cleaned up on
exit, including on `Ctrl-C`.

## Regenerating it

```sh
cd scripts/portfolio
npm install        # one-time; installs playwright, ffmpeg-static, ffprobe-static
cd ../..
node scripts/portfolio/capture-demo.mjs
```

Outputs are written to this folder, overwriting the previous versions. Each
run uses fresh browser sessions, so the pseudonyms shown in the demo will
differ from run to run — that's expected, and is itself part of what shows
the sessions are genuinely independent rather than staged.
