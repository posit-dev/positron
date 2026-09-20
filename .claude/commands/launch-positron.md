# Launch the Positron IDE for development

Follow this exact sequence.

Steps 1 and 2 are worktree preflight. A freshly created worktree can have an
incomplete `node_modules`, and both variants surface later as the same useless
message: `Error: tsgo exited with code 1` right after a line claiming `0 errors`.
Check them up front instead of decoding that.

1. The tsgo native binary is actually present (`npm install` does NOT restore it -
   npm sees the package directory and reports "up to date"):

	```bash
	node -e "const{createRequire}=require('module'),p=require('path'),cp=require('child_process');const tsc=p.join(p.dirname(createRequire(process.cwd()+'/package.json').resolve('@typescript/native/package.json')),'bin','tsc');cp.execFileSync(process.execPath,[tsc,'--version'],{stdio:'inherit'})"
	```

	Expected: `Version 7.x.x`. If it throws `Executable not found: .../@typescript/typescript-<platform>-<arch>/lib/tsc`,
	delete that package directory and reinstall it:

	```bash
	rm -rf node_modules/@typescript/typescript-<platform>-<arch> && npm install
	```

2. The `ai-lib` workspace packages are built. Without their `dist/` output,
   watch-client fails with `Cannot find module 'ai-config/node'` and friends:

	```bash
	[ -d ai-lib/packages/ai-config/dist ] || npm run build:ai-lib
	```

3. Check if daemons are running:

	```bash
	npm run build-ps
	```

4. If daemons are missing or `stopped`, start them in background:

	```bash
	npm run build-start
	```

5. Wait for daemons to finish compiling WITHOUT errors:

	```bash
	npm run build-check
	```

6. If `build-check` reports errors, do not trust them until you have re-run the
   daemon that produced them. `build-check` replays the daemon's last compilation
   cycle, so it keeps showing errors from before a fix you just made. Restart that
   daemon and re-check:

	```bash
	npx deemon -- --kill npm run <daemon> && npx deemon -- --detach npm run <daemon> && npm run build-check
	```

	Only errors that survive the restart are real. Fix them before launching.

7. Launch Positron in the background (use run_in_background=true):

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

8. IMMEDIATELY respond with a brief confirmation like "Positron launched in background" - do NOT wait for verification or monitor output.
