# Handoff: feature/refactor-databricks-auth

Branch: `feature/refactor-databricks-auth`, based on `main` at `ea5fd59fdeb`

4 commits, clean working tree.

## The belief driving this branch

Databricks auth was duplicated: the data connection driver had its own PAT / OAuth
/ service principal logic, separate from the auth extension's own Databricks
provider. Two independent sources of truth for the same credential is a bug
generator -- they can disagree, and whichever one the user isn't looking at is
wrong. This branch makes the auth extension the single owner of Databricks
credentials; the driver becomes a consumer that asks for a session and hands the
token to the SDK.

That required adding one capability the auth extension didn't have: service
principal (OAuth machine-to-machine) credentials. Not a like-for-like port -- the
driver used to hand `clientId`/`clientSecret` straight to `@databricks/sql`'s own
`authType: 'databricks-oauth'`, which did the token exchange, scope, and refresh
opaquely inside the SDK. The auth extension now does that exchange itself:
explicit HTTP Basic auth for the credentials, an explicit scope with no
`offline_access` (the grant has no refresh token to use it for), and explicit
expiry tracking so the credential chain knows when to replay the exchange.

A second, smaller belief: silently falling back to "the driver's first mechanism"
when a saved connection's mechanism can't be found is worse than failing loudly.
It quietly rebinds a connection to different auth than the one it was set up with.
Failing and telling the user to reconfigure is the safer default, even though it's
a worse one-time experience.

Worth reconsidering, not just accepting: does "auth extension owns all
credentials" still hold now that the driver is fully cut over, or did the
migration surface a case where the driver legitimately needs to know something the
extension doesn't? The branch currently assumes no.

**A concrete cost of that assumption:** before this branch, each connection
profile carried its own credential inline (its own PAT, or its own service
principal), so a user could be connected to two different Databricks workspaces at
once, each under its own credential. After this branch, the auth extension
registers one Databricks provider with `{ supportsMultipleAccounts: false }`, so
there's exactly one active Databricks sign-in, shared by every connection profile.
Connecting to a second workspace while signed in elsewhere now reuses the same
credential -- which is why this branch also added a check, at connect time, that
the session is valid for the workspace being connected to (otherwise the SQL
endpoint rejects it with a bare 401 that reads like a broken credential rather than
a wrong workspace).

This is not a platform limitation: VS Code's `AuthenticationProviderOptions`
supports multiple simultaneous accounts per provider, and callers can pass an
`account` to `getSessions`/`createSession` to pick one. Using it here would need
more than flipping the flag -- `DatabricksAuthProvider` would need to manage
multiple distinct sessions, and each connection profile would need to record which
account it belongs to. None of that is done on this branch; the single-account
behavior is a deliberate simplification, not something the API forced.

## What each commit did

**1. Fail a data connection whose mechanism the driver dropped** (`6ebf3340fae7`)

`resolveDataConnectionMechanism` used to fall back to the driver's first mechanism
for any id it couldn't find, conflating two cases: a profile saved before
mechanisms existed (no id at all -- should fall back) and a profile whose
mechanism the driver has since removed or renamed (shouldn't -- that silently
rebinds it to unrelated credentials). Now it falls back only when the id is
genuinely absent; an unrecognized id returns undefined, and connecting or editing
tells the user to remove and re-add the connection.

**2. Resolve Databricks service principal credentials in the auth extension**
(`1b6f8785af85`)

The auth extension already handled interactive OAuth, `DATABRICKS_TOKEN`, a
`.databrickscfg` profile, and Workbench-managed credentials, but had no
client-credentials grant of its own -- a service principal only worked if
something external minted a token into the config file first. This adds the grant
directly: reads `DATABRICKS_CLIENT_ID`/`DATABRICKS_CLIENT_SECRET` (the same
variables the Databricks SDKs read), takes the workspace host from
`DATABRICKS_HOST` or the configured provider host, and exchanges them via HTTP
Basic auth (not the form body). The grant issues no refresh token, so the
credential carries its own expiry and the chain replays the exchange when it
lapses. Resolution order: below `DATABRICKS_TOKEN` (more specific), above the
config file.

**3. Authenticate Databricks connections through the auth extension**
(`5f8c56a0ece1`)

The cutover. The driver's own PAT / OAuth / service principal implementations are
removed and replaced with one mechanism: ask the auth extension for a session, hand
the token to the SDK's external-token auth, which calls back whenever it needs a
fresh one. The driver stores no credential of its own, and a refreshed or rotated
credential is picked up without rebuilding the connection. A saved profile shrinks
to just the workspace hostname, HTTP path, and optional catalog/schema. Generated
Python and R snippets no longer embed a credential -- they run in the user's own
session, where `databricks-sql-connector` and `odbc::databricks()` resolve one
themselves, so embedding one was both redundant and a way to leak a secret into a
copyable code block.

**4. Stop generating connection code for a dropped mechanism** (`50f5a045125`)

Commit 1's fix didn't reach every call site: the actions menu's code-generation
path and `getDataConnections` (the payload Assistant reads to discover configured
connections) still fell back to the profile's stale mechanismId instead of
refusing, so they'd still call `generateConnectionCode` against a mechanism the
driver no longer declares. This closes both. The actions menu leaves the
language-specific "Connect With" options out of the menu when the mechanism can't
resolve, while keeping Edit Connection and Remove so the user can still act on the
connection. `getDataConnections` reports the profile's own mechanismId with no
per-language code -- matching what it already does when the driver itself isn't
registered.

