# Launch the Positron IDE for development

Follow this exact sequence.

Step 1 is worktree preflight. It matters when `node_modules` was copied or
partially restored rather than installed by `npm install` (a worktree seeded
from another checkout, an interrupted copy). `npm install` then reports "up to
date" because the package directories exist, and the build fails later with
the unhelpful `Error: tsgo exited with code 1` right after a line claiming
`0 errors`.

1. Confirm the TypeScript 7 compiler binary and the `ai-lib` build output are
   present:

	```bash
	node node_modules/@typescript/native/bin/tsc --version
	[ -d ai-lib/packages/ai-config/dist ] || npm run build:ai-lib
	```

	Expected: `Version 7.x.x`. If the first command throws instead, the
	per-platform package that holds the binary is broken; delete it and
	reinstall, then re-run the check:

	```bash
	rm -rf node_modules/@typescript/typescript-<platform>-<arch> && npm install
	```

2. Check if daemons are running:

	```bash
	npm run build-ps
	```

3. If daemons are missing or `stopped`, start them in background:

	```bash
	npm run build-start
	```

4. Wait for daemons to finish compiling WITHOUT errors:

	```bash
	npm run build-check
	```

5. If `build-check` reports errors, do not trust them until you have re-run the
   daemon that produced them. `build-check` replays the daemon's last compilation
   cycle, so it keeps showing errors from before a fix you just made. Restart that
   daemon and re-check:

	```bash
	npx deemon -- --kill npm run <daemon> && npx deemon -- --detach npm run <daemon> && npm run build-check
	```

	Only errors that survive the restart are real. Fix them before launching.

6. Launch Positron in the background (use run_in_background=true):

	```bash
	./scripts/code.sh --use-inmemory-secretstorage
	```

	`--use-inmemory-secretstorage` suppresses the macOS "Positron wants to use your
	confidential information stored in 'code-oss-dev Safe Storage'" keychain prompt.
	Secret storage then skips the encryption service entirely rather than reaching
	for the OS keyring. The e2e harness passes the same flag (test/e2e/infra/electron.ts).

	Trade-off: secrets do not persist across restarts, so anything using
	SecretStorage (GitHub sign-in, Assistant/Copilot tokens) needs re-authenticating
	each launch. Drop the flag for a session where you need a sign-in to stick.

7. IMMEDIATELY respond with a brief confirmation like "Positron launched in background" - do NOT wait for verification or monitor output.
