// Shared by every spec file whose PATCH calls need a valid Crit 10
// session — see notes/adr/0002-identity-and-permissions.md. A PATCH with
// no session is rejected (spec/identity.test.ts covers that rejection
// directly); every other spec file's PATCH calls are checking something
// else entirely (persistence, concurrency, decay, realtime) and just need
// *a* valid session to get past authentication, not a particular one.
export async function sessionCookie(baseUrl: string): Promise<string> {
  const res = await fetch(new URL("/", baseUrl));
  const header = res.headers
    .getSetCookie()
    .find((h) => h.startsWith("toadlive_session="));
  if (!header) throw new Error("GET / did not issue a toadlive_session cookie");
  return header.split(";")[0]!;
}
