# Crit 10 reflection

**What was the breakthrough that moved the work forward?**

Not the session model itself — that was a design decision, interrogated
and justified before a line of it existed. The breakthrough was what the
live deployment exposed that nothing local did: the session cookie's
`Secure` attribute was silently never being set in production. Locally,
and by inspection, the logic looked correct — `Secure` only over HTTPS,
plain HTTP on localhost untouched. But the app doesn't see HTTPS at all;
Fly's proxy terminates TLS in front of it and forwards every request
over plain HTTP, so the one signal the code checked read `"http:"` even
on the real `https://…fly.dev` site. Only `curl`ing the actual deployed
`Set-Cookie` header surfaced the gap between what the app believed about
its own request and what the browser had actually connected with — the
same shape as Crit 8's timestamp bug, a lesson I'd already written down
and still nearly didn't apply here. The fix became a small, named,
regression-tested helper instead of an inline assumption.

**What did this change about who I want to be as a developer?**

I want production observability to be routine verification, not a
backstop I reach for when something already looks wrong. Narrating two
pseudonymous actors' reports, a conflict, and a re-confirmed success
from `flyctl logs` alone — never touching the app myself — only proves
anything because the logs were checked against the real deployed
process, not assumed correct from the code. Local correctness and
deployed behavior are different claims, and I want to keep treating the
gap between them as the default question, not a rare exception.
