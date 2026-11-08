# Deploying the recruiter case study

The recruiter-facing `/portfolio/` page and the submitted Toad Live product
are two separate deployments, on purpose.

## Two URLs, two purposes

| | URL | What it is |
|---|---|---|
| **The actual live product** | https://comp4020-final-astra-erevos.fly.dev | The submitted COMP8020 app: Astro + Node server, SQLite on a Fly volume, real SSE/concurrency behaviour. Unaffected by anything in this file. |
| **The case study** | https://comp4020-agentic-coding-studio.github.io/comp4020-final-astra-erevos/ | A static export of `src/pages/portfolio.astro` only — no server, no database, nothing interactive. |

The case study's "Open live demo" button always points at the Fly URL above —
it never pretends to be the product itself.

## Why it's a separate deployment

A second Fly app was considered and rejected: the course-issued
`FLY_API_TOKEN` is scoped to the existing app only (confirmed by testing —
`flyctl apps create` returns `unauthorized`), and spinning up a full second
Astro server just to show a static page would mean paying for and
maintaining a second SQLite-backed Node process for content that never
touches a database. GitHub Pages needs no new account, no new token, and
ships only static files.

## How it works

`src/pages/portfolio.astro` is the single source for both targets:

- **Fly build** (`astro.config.ts`, no `base` set) — the page builds as part
  of the normal server build and is prerendered to a static file Astro
  still serves from the running Node process. Nothing here changed.
- **Pages build** (`astro.config.pages.ts`, `base: "/comp4020-final-astra-erevos/"`)
  — same page, same source, but every internal path (`import.meta.env.BASE_URL`)
  resolves under the GitHub Pages project-site subpath instead of the domain
  root. External links (GitHub, the Fly demo URL, the `#case-studies` anchor)
  are unaffected either way.

`.github/workflows/portfolio-pages.yml` builds with the Pages config, copies
out only `dist-pages/client/portfolio/**` and the CSS it needs (never the
server chunks or any API route output), adds a one-line HTML redirect from
the Pages root to `/portfolio/`, and publishes that. It triggers only on
pushes to `portfolio` and is gated (`if: github.ref == 'refs/heads/portfolio'`)
independently of its trigger, so it can never run for `main` and never touches
`FLY_API_TOKEN` or `flyctl`.

`.github/workflows/checks.yml` (the submitted app's own CI/deploy) is
unmodified and still only runs for `main`.

## Updating the case study

Push to `portfolio`. The `portfolio-pages` workflow rebuilds and republishes
automatically — there's no manual deploy step. To test a change locally
first:

```
npx astro build --config astro.config.pages.ts --outDir dist-pages
```

Then serve `dist-pages/client` under a local path prefixed with
`/comp4020-final-astra-erevos/` to see it the way GitHub Pages will.

## What never happens here

- No step in `portfolio-pages.yml` can deploy to Fly — it has no
  `FLY_API_TOKEN` in its environment and never calls `flyctl`.
- No SQLite volume is provisioned for the case study — it's static files,
  there's nothing to persist.
- The submitted app's `fly.toml`, `Dockerfile`, and `checks.yml` are
  untouched by this change.
