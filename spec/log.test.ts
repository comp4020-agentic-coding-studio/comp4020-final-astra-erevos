import { expect, it } from "vitest";
import {
  formatReportOutcome,
  formatReportRejected,
  formatSessionCreated,
} from "../src/lib/log.ts";

// Crit 10's logging layer (src/lib/log.ts) is a pure, mechanically
// testable line-formatting helper precisely so its shape can be checked
// here rather than only by eye against a real `flyctl logs` tail — see
// notes/adr/0002-identity-and-permissions.md. These tests run in this
// same process (they import the module directly, not over HTTP), unlike
// every other spec/*.test.ts file, which checks the deployed app's
// observable behaviour. A log line's actual appearance in a real
// `flyctl logs` stream during the crit is the final human verification
// these can't replace.
//
// Every assertion here matches the exact line shapes specified in the
// ADR/PROCESS.md, since those are what a person narrating the crit from
// the log stream will be pattern-matching against.

it("formats a session_created line naming the pseudonym and nothing else", () => {
  const line = formatSessionCreated("Toad-7F3A9C");
  expect(line).toBe("[toadlive] actor=Toad-7F3A9C action=session_created");
});

it("formats a successful report with actor, machine, status, result, and version", () => {
  const line = formatReportOutcome({
    actor: "Toad-7F3A9C",
    machine: "e-dryer",
    status: "in-use",
    result: "ok",
    version: 8,
  });
  expect(line).toBe(
    "[toadlive] actor=Toad-7F3A9C machine=e-dryer action=report status=in-use result=ok version=8",
  );
});

it("formats a concurrency conflict the same shape, with result=conflict", () => {
  const line = formatReportOutcome({
    actor: "Toad-C21E88",
    machine: "e-dryer",
    status: "available",
    result: "conflict",
    version: 8,
  });
  expect(line).toBe(
    "[toadlive] actor=Toad-C21E88 machine=e-dryer action=report status=available result=conflict version=8",
  );
});

it("formats a no-session rejection with actor=(none) and no status field", () => {
  const line = formatReportRejected({ actor: "(none)", machine: "e-dryer", reason: "no-session" });
  expect(line).toBe("[toadlive] actor=(none) machine=e-dryer action=report result=rejected reason=no-session");
  expect(line).not.toContain("status=");
});

it("formats a client-actor-claim rejection naming the real actor, never a forged value", () => {
  const line = formatReportRejected({
    actor: "Toad-7F3A9C",
    machine: "e-dryer",
    reason: "client-actor-claim",
  });
  expect(line).toBe(
    "[toadlive] actor=Toad-7F3A9C machine=e-dryer action=report result=rejected reason=client-actor-claim",
  );
});

it("never produces a line containing a token, hash, or internal id shape", () => {
  // A real pseudonym/machine/reason never collides with these patterns;
  // this guards against a future call site accidentally passing a raw
  // credential instead of a pseudonym.
  const lines = [
    formatSessionCreated("Toad-AAAAAA"),
    formatReportOutcome({ actor: "Toad-AAAAAA", machine: "ab-washer", status: "available", result: "ok", version: 2 }),
    formatReportRejected({ actor: "(none)", machine: "ab-washer", reason: "no-session" }),
  ];
  for (const line of lines) {
    expect(line).not.toMatch(/[0-9a-f]{32,}/i); // a hex-encoded hash/token is long and lowercase-hex
    expect(line).not.toMatch(/[A-Za-z0-9_-]{40,}/); // a base64url token is long and unbroken
  }
});
