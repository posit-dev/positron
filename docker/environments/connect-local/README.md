# Connect-Local

Run the publisher / Posit Connect e2e tests **locally** against an ephemeral
Posit Connect, driving a plain local Positron desktop (electron) -- no Workbench
required. This is the electron coverage for the connect tests; the web/chromium
coverage still runs under the Workbench CI (`@:workbench`).

Connect is stood up by [`with-connect`](https://github.com/posit-dev/with-connect),
a first-party CLI that runs Connect in Docker and hands back a freshly
bootstrapped API key. The [`with-connect.sh`](with-connect.sh) wrapper here
adapts it to what the tests expect (Connect on `localhost:3939`, the key written
to `./.tokens/connect_bootstrap_token`).

The tests live in [`test/e2e/tests/connect/`](../../../test/e2e/tests/connect/)
and run under the `e2e-connect` Playwright project.

## Prerequisites

1. **Docker** with access to the private GHCR Connect images. Log in once:
   `docker login ghcr.io` (or `gh auth token | docker login ghcr.io -u <you> --password-stdin`).
2. **The `with-connect` CLI** (needs Docker + Python 3.13+; `uv` provides Python):

   ```bash
   uv tool install git+https://github.com/posit-dev/with-connect.git
   ```

3. **Connect license** at `connect/connect.lic`. If you already run the Workbench
   stack, the wrapper reuses `../wb-local/connect/connect.lic` automatically;
   otherwise drop a `connect.lic` in this directory.

No `/etc/hosts` entry is needed: with-connect publishes Connect on
`localhost:3939` and the local run points the tests there directly.

## Usage

```bash
# Bring Connect up and bootstrap the API token (writes ./.tokens/connect_bootstrap_token)
npm run connect:start

# Run the tests (electron)
npx playwright test --project e2e-connect test/e2e/tests/connect/

# Check status / print the token
npm run connect:status
npm run connect:token

# Stop and remove the container
npm run connect:stop
```

Connect is **ephemeral**: every `connect:start` begins from a clean slate, so the
bootstrapped key rotates each run. Pin the Connect version with `CONNECT_VERSION`
(e.g. `CONNECT_VERSION=preview npm run connect:start`) or a full image ref with
`CONNECT_IMAGE`.

## How the token is resolved

The test resolver ([`test/e2e/pages/connect.ts`](../../../test/e2e/pages/connect.ts),
`resolveApiKey`) tries, in order:

1. `CONNECT_PUBLISHER_API_KEY` env var
2. a local token file (`CONNECT_PUBLISHER_TOKEN_FILE`, else
   `./.tokens/connect_bootstrap_token` written by `connect:start`)
3. the Workbench `test` container's `/tokens` volume (used by the Workbench run)

## Authentication and user1 sign-in

Connect runs with PAM authentication, matching the Workbench lane. The wrapper
enables it by passing `CONNECT_AUTHENTICATION_PROVIDER=pam` /
`CONNECT_PAM_SERVICE=rstudio-connect` env overrides to with-connect (rather than a
replacement config file, which would have to hard-code the image's R/Python/Quarto
paths). The publisher tests then create a system `user1` in the Connect container
(via `docker exec`, targeting the container id from `.tokens/.container_id`) and
sign in as that viewer. PAM auth avoids the built-in password provider's
account-confirmation step, which has no programmatic bypass.

The final step of each test signs in to Connect as `user1`; the password just
needs to be consistent and defaults to `testpassword`, so no configuration is
required. To override it, set `POSIT_WORKBENCH_PASSWORD` in your shell or in a
root-level `.env.e2e-connect` file (loaded automatically for the `e2e-connect`
project), e.g.:

```
POSIT_WORKBENCH_PASSWORD=my-password
```

## Notes

- Because Connect is ephemeral, the bootstrap key changes on every start. The
  local `e2e-connect` `beforeAll` detects the key change and clears the stale
  "Posit Publisher Safe Storage" keychain entry (macOS) so the publish flow
  re-enters the fresh key.
- The Connect images are multi-arch, so they run natively on Apple Silicon.
- Deployed content must be authored against R/Quarto versions compatible with the
  image's bundled runtimes; Connect's environment reconciliation for Publisher
  deploys does not fall back via `R.VersionMatching`/`Quarto.VersionMatching`.
