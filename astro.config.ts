import { defineConfig } from "astro/config";
import node from "@astrojs/node";

// Server output: the API routes that read/write machine status need to run
// per-request, not be pre-rendered at build time. "standalone" mode gives a
// plain Node server (dist/server/entry.mjs) that reads HOST/PORT from the
// environment, which is exactly what the Dockerfile/fly.toml expect: plain
// HTTP on 0.0.0.0:$PORT, no separate web server in front of it.
export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
});
