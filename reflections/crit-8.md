# Crit 8 reflection

**What was the breakthrough that moved the work forward?**

The real turning point wasn't a feature — it was breaking something. After
the persistence slice passed every local test, I set out to verify it
survived a real Fly redeploy, not just a local restart. A malformed
timestamp I sent by accident got written straight into SQLite, and the row
it landed on started 500ing on every later request, not just that one. That
forced a real diagnosis: reading the live logs back to the exact failing
line, reproducing it locally, and fixing the actual gap — validating
`startedAt`/`expectedEndAt` before they ever reach the database — rather
than just resetting the row and moving on. The breakthrough was realising a
green `pnpm check` had never actually proven the thing I cared about (a
redeploy holding real data), and that the fix only counted once it was a
rejection, a regression test, and a `CLAUDE.md` rule, not a one-off patch.

**What did this change about who I want to be as a developer?**

I want to be someone who goes looking for the failure rather than stopping
once the happy path is green. Deciding Toad Live was for Toad Hall
residents specifically, not a generic laundry app, was the same instinct
one level up — the constraint made the thing better, not smaller. The
timestamp incident taught me that at the implementation level too: an agent
that hits a real bug and just resets the data hasn't actually fixed
anything. I want every corrected failure to leave something durable behind
— a test, a rule, a decision record — so the same mistake can't quietly
happen again.
