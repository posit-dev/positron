# Mock AWS auth server

A standalone dev tool for testing AWS (Bedrock) authentication. It stands in for
AWS STS and answers the `AssumeRoleWithWebIdentity` call the AWS SDK makes for
web-identity auth, so the authentication extension's Bedrock credential chain
(`extensions/authentication/src/credentials/aws.ts`) can be exercised from a
source build without Posit Workbench.

It is **not** part of the shipped product -- it is a local Node server.

## Why web identity

On Posit Workbench, Bedrock credentials come from web-identity auth: the session
sets `AWS_WEB_IDENTITY_TOKEN_FILE` and `AWS_ROLE_ARN`, a session agent writes an
OIDC token to that file, and the SDK exchanges the token with STS for temporary
credentials. The agent writes the token asynchronously, so it can show up after
the extension has already tried to resolve credentials
(posit-dev/positron#15292). This server plays both parts: it stands in for STS,
and it writes the token file when you ask, standing in for the session agent. So
you control when the token appears and see every exchange the extension makes.

## What it serves

| Request | What asks for it | Response |
| --- | --- | --- |
| `POST /` with `Action=AssumeRoleWithWebIdentity` | the SDK's web-identity credential provider | credentials, or `InvalidIdentityToken` while failing |
| `GET /token` | you, in place of the Workbench session agent | writes (or rewrites) the token file |
| `GET /fail` | you, to make later exchanges reject the token | plain-text confirmation |
| `GET /succeed` | you, to go back to answering with credentials | rewrites the token file too, so Positron retries |

The token file only proves identity to STS, and this server doesn't check it, so
the server writes placeholder content (`mock-token-1`, `mock-token-2`, ...). It
is not the same thing as the credentials below, which are what Bedrock checks.
Each successful exchange logs a numbered line, so the server log shows exactly
how many times the extension went to STS.

The token file is `/tmp/mock-aws-auth/id_token` unless you pass
`--token-file`. On startup the server removes a token file left by an earlier
run, so Positron starts out without one; it leaves alone a file it did not
write.

## Fake or real credentials

The server never contacts AWS. Whatever it puts in its `AssumeRoleWithWebIdentity`
response is what the extension signs in with, and what Bedrock later sees.

By default it answers with fake credentials, distinct per exchange (`ASIAMOCK1`,
`ASIAMOCK2`, ...). That is enough to test when and how often the extension
resolves credentials, but Bedrock rejects them, so model listing and chat fail
after sign-in.

To test end to end, give the server real credentials with Bedrock access, in one
of two ways. Both need the AWS CLI v2; for an SSO profile, run
`aws sso login --profile <profile>` first.

**From a profile (`--profile`).** The server runs
`aws configure export-credentials --profile <profile>` on every exchange and
answers with the result. Because it reads them again each time, an SSO session
that expires while the server runs only needs another `aws sso login`, not a
restart.

```bash
npm run mock-aws-auth-server -- --profile <profile>
```

**From env vars (`MOCK_AWS_*`).** Use this for credentials that do not live in
a CLI profile, or to pin one set of credentials for the whole run. The server
reads `MOCK_AWS_ACCESS_KEY_ID`, `MOCK_AWS_SECRET_ACCESS_KEY`, and optionally
`MOCK_AWS_SESSION_TOKEN` and `MOCK_AWS_CREDENTIAL_EXPIRATION`. They are
prefixed so they can't be mistaken for the SDK's own `AWS_*` variables. To
fill them from a profile, run this in a subshell, so the exported `AWS_*`
variables don't stay in your shell:

```bash
(
	eval "$(aws configure export-credentials --profile <profile> --format env)"
	MOCK_AWS_ACCESS_KEY_ID=$AWS_ACCESS_KEY_ID \
	MOCK_AWS_SECRET_ACCESS_KEY=$AWS_SECRET_ACCESS_KEY \
	MOCK_AWS_SESSION_TOKEN=$AWS_SESSION_TOKEN \
	MOCK_AWS_CREDENTIAL_EXPIRATION=$AWS_CREDENTIAL_EXPIRATION \
	npm run mock-aws-auth-server
)
```

These credentials are fixed when the server starts. Restart the server once they
expire.

The startup line says which source is in use and when the credentials expire,
e.g. `credentials from AWS profile <profile>, with their real expiration`. Pass
`--duration` to make any source expire sooner; see
[Testing a rotated token at credential expiry](#testing-a-rotated-token-at-credential-expiry).

## Running it

```bash
npm run mock-aws-auth-server                          # port 4599, fake credentials lasting an hour
npm run mock-aws-auth-server -- --profile <profile>   # real credentials, so Bedrock calls succeed (see above)
npm run mock-aws-auth-server -- --port 9000
npm run mock-aws-auth-server -- --duration 120        # credentials that expire after 2 minutes, to exercise expiry refresh
npm run mock-aws-auth-server -- --fail                # start out rejecting tokens
npm run mock-aws-auth-server -- --token-file <path>   # a different token file location
```

From VS Code, run the **Mock AWS Auth Server** task (Tasks: Run Task) instead.
It uses fake credentials; run the server from a terminal for real ones.

Then, in a separate terminal, launch Positron from sources with web-identity auth
pointed at the server. The server prints these lines at startup, with its port and
token file filled in. `AWS_ENDPOINT_URL_STS` is the SDK's standard per-service
endpoint override. Clear any other AWS credentials, or the SDK's provider chain
uses them first, and set `AWS_REGION` to a region where the profile has Bedrock
access if you are using real credentials:

```bash
export AWS_WEB_IDENTITY_TOKEN_FILE=/tmp/mock-aws-auth/id_token
export AWS_ROLE_ARN=arn:aws:iam::123456789012:role/bedrock
export AWS_ENDPOINT_URL_STS=http://localhost:4599
export AWS_REGION=us-east-1
unset AWS_PROFILE AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN
export AWS_CONFIG_FILE=/dev/null AWS_SHARED_CREDENTIALS_FILE=/dev/null

./scripts/code.sh --log positron.authentication:debug
```

The extension logs to the **Authentication** output channel, with `[AWS]` on
each line. Use `--log ... :debug`: a failed resolve for a provider that has never
been signed in logs only at debug level.

## Testing a token file that arrives late (#15292)

1. Start the server. It removes any token file and folder from an earlier
   run, so neither exists. A missing folder is the harder case, because a
   regular file system watcher would miss the file being created.
2. Launch Positron as above. The Authentication channel logs a failed
   `[AWS]` credential resolution with `ENOENT ... id_token`, and the server
   logs no exchange.
3. Have the server write the token while Positron is running:

   ```bash
   curl localhost:4599/token
   ```

4. Within about 5 seconds (the token file poll interval), the server logs
   `AssumeRoleWithWebIdentity #1` and the channel logs `[AWS] Credential
   resolution resolved`. You don't need to reload or open the Accounts menu.
5. With real credentials, Bedrock models load and an Assistant prompt using a
   Bedrock model succeeds.

Before the fix, step 4 never happened: nothing retried the resolve, and every
Assistant prompt failed with "No credentials available for provider: bedrock"
until the window was reloaded.

## Testing that a rewritten token does not re-sign-in

Workbench rewrites the token every few minutes. Credentials that are still held
should not be exchanged again on every rewrite, or each rewrite would replace
the session.

1. Sign in as in the previous section, so the server has logged `#1`.
2. Rewrite the token a few times, waiting more than 5 seconds between writes:

   ```bash
   curl localhost:4599/token
   ```

3. The server logs no new exchanges.

## Testing a rotated token at credential expiry

Held credentials are only exchanged again when they are about to expire: the
next time something asks Positron for a session within a minute of expiry, it
reads whatever token is in the file then. Each exchange line in the server log
shows the token it was given, so you can see the rotated one being used.

1. Start the server with short-lived credentials:
   `npm run mock-aws-auth-server -- --duration 120`. `--duration` works with
   real credentials too (`--profile <profile> --duration 120`). The server
   reports the shorter expiration to Positron, so you don't have to wait for
   the real one, which can be hours away. Without `--duration`, real
   credentials keep their real expiration. The startup line shows which
   applies.
2. Sign in with `curl localhost:4599/token`. The server logs
   `#1 ... token=mock-token-1`.
3. Rotate the token with `curl localhost:4599/token`. The server logs no
   exchange.
4. After about a minute, do something that asks for a session, such as sending
   an Assistant prompt. The server logs `#2 ... token=mock-token-2`.

## Testing recovery after a rejected token

1. Start the server with `--fail`, launch Positron, and `curl localhost:4599/token`.
   The server logs `-> InvalidIdentityToken`, and the Authentication channel
   logs the failed resolve.
2. `curl localhost:4599/succeed`. That switches the server to answering with
   credentials and rewrites the token file. Because no credentials are held,
   the newer token triggers a retry: the server logs `#1` and the extension
   signs in. Switching modes alone would not be enough. Positron does not
   contact the server again until the token changes, as on Workbench.

## Useful log lines

Authentication channel:

```
[AWS] Credential chain initialized (region=us-east-1, profile=(default))
[AWS] Credential resolution failed: ENOENT: no such file or directory, open '/tmp/mock-aws-auth/id_token'
[AWS] Credential resolution resolved
```

Server:

```
AssumeRoleWithWebIdentity #1 role=arn:aws:iam::123456789012:role/bedrock token=mock-token-1 -> ASIAMOCK1, expires 2026-10-02T18:00:00.000Z
AssumeRoleWithWebIdentity role=arn:aws:iam::123456789012:role/bedrock token=mock-token-1 -> InvalidIdentityToken
AssumeRoleWithWebIdentity role=... -> could not export credentials for profile <profile>: ...
wrote token #1 to /tmp/mock-aws-auth/id_token
```
