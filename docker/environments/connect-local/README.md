# Connect-Local

Run the publisher / Posit Connect e2e tests **locally** against a standalone
Posit Connect container, driving a plain local Positron desktop (electron) --
no Workbench required. This is the electron coverage for the connect tests; the
web/chromium coverage still runs under the Workbench CI (`@:workbench`).

The tests live in [`test/e2e/tests/connect/`](../../../test/e2e/tests/connect/)
and run under the `e2e-connect` Playwright project.

## Prerequisites

1. **Docker** with access to the private GHCR images (the one-shot token
   bootstrap uses `ghcr.io/posit-dev/positron-ubuntu24`). Log in once:
   `docker login ghcr.io` (or `gh auth token | docker login ghcr.io -u <you> --password-stdin`).
2. **Connect license** at `connect/connect.lic`. If you already run the
   Workbench stack, `run.sh` reuses `../wb-local/connect/connect.lic`
   automatically; otherwise drop a `connect.lic` in this directory.
3. **`/etc/hosts` entry** so the publisher's stored `connect:3939` credential
   resolves on the host (the credential URL is kept as `connect:3939` in both
   local and Workbench modes so the same keychain entry works everywhere):

   ```
   127.0.0.1 connect
   ```

## Usage

```bash
# Bring Connect up and bootstrap the API token (writes ./.tokens/connect_bootstrap_token)
npm run connect:start

# Run the tests (electron)
npx playwright test --project e2e-connect test/e2e/tests/connect/

# Check status / print the token
npm run connect:status
npm run connect:token

# Stop (data preserved -- bootstrap key + saved credential stay valid)
npm run connect:stop

# Full reset (remove the connect-data volume and local token; next start re-bootstraps)
cd docker/environments/connect-local && ./stop-containers.sh --wipe
```

## How the token is resolved

The test resolver ([`test/e2e/pages/connect.ts`](../../../test/e2e/pages/connect.ts),
`resolveApiKey`) tries, in order:

1. `CONNECT_PUBLISHER_API_KEY` env var
2. a local token file (`CONNECT_PUBLISHER_TOKEN_FILE`, else
   `./.tokens/connect_bootstrap_token` written by `connect:start`)
3. the Workbench `test` container's `/tokens` volume (used by the Workbench run)

## user1 sign-in password

The final step of each test signs in to Connect as `user1`. Locally the test
creates that account itself, so the password just needs to be consistent: it
defaults to `testpassword` (used both to set the PAM password in the `connect`
container and to sign in), so no configuration is required. To override it, set
`POSIT_WORKBENCH_PASSWORD` in your shell or in a root-level `.env.e2e-connect`
file (loaded automatically for the `e2e-connect` project), e.g.:

```
POSIT_WORKBENCH_PASSWORD=my-password
```

## Notes

- The `connect-data` volume is **persistent** so the bootstrap key stays valid
  across runs, which keeps a saved publisher keychain credential working.
- If you `--wipe`, Connect re-bootstraps a new key. The local `e2e-connect`
  `beforeAll` detects the key change and clears the stale "Posit Publisher Safe
  Storage" keychain entry (macOS) so the publish flow re-enters the fresh key.
- Connect's image is `linux/amd64`; on Apple Silicon it runs under emulation
  (slower first start -- the health wait accounts for this).
