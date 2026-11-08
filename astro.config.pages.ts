import { defineConfig } from "astro/config";
import node from "@astrojs/node";

// Second build target, used only by the portfolio-deploy workflow on the
// `portfolio` branch — never by Fly. Same output mode/adapter as
// astro.config.ts (so src/pages/portfolio.astro compiles identically and
// nothing about the live app's routes/API/build changes), but with `site`
// and `base` set for GitHub Pages' project-site subpath. That's what makes
// import.meta.env.BASE_URL resolve to "/comp4020-final-astra-erevos/" here
// instead of "/", which src/pages/portfolio.astro reads to prefix every
// internal asset/link it renders.
//
// The build this config produces still compiles the whole app (API routes,
// index.astro, etc.) because nothing here changes what gets built — only
// the portfolio-deploy workflow decides what gets published, and it ships
// only dist/client/portfolio/** (the one prerendered page plus its copied
// assets), never the server chunks or the rest of the static client output.
export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  site: "https://comp4020-agentic-coding-studio.github.io",
  base: "/comp4020-final-astra-erevos/",
});
