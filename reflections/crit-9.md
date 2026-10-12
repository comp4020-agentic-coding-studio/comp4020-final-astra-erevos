# Crit 9 reflection

**What was the breakthrough that moved the work forward?**

The breakthrough wasn't choosing SSE or adding a version column — it was
realizing, partway through designing the concurrency model, that lazy
decay from Crit 8 is also a canonical mutation. I'd first designed
versioning only around resident reports; a stale report resurrecting a
state the server's own decay had already invalidated would have been
exactly the silent-overwrite failure optimistic concurrency was supposed
to prevent, just hidden one layer down. Catching that before writing code,
not after, is what made rejecting last-write-wins actually mean something,
rather than a decision that only covered half the real cases. That same
instinct paid off again during implementation, where a couple of test bugs
turned out to be real timing assumptions the system didn't actually hold,
not edge cases invented to pad coverage.

**What did this change about who I want to be as a developer?**

I want to stop treating a green automated suite as proof a real-time
feature actually works. The two-browser check — local, then again against
the live Fly deployment — showed a report reaching another open session
with no reload, which the tests already claimed; what mattered more was
deliberately forcing a stale browser state afterward, seeing the real 409
conflict message appear in the actual UI, confirming the newer canonical
state hadn't been silently overwritten, and then re-confirming the report
explicitly and watching it succeed. That's the part no API-level test
could have told me was readable or reassuring to an actual person, and I
want that kind of manual pass to stay mandatory for anything users
experience concurrently, not a nice-to-have after the tests go green.
