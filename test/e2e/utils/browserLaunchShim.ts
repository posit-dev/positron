/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { delimiter, join } from 'path';

// Captures the URLs a *bundled SDK* hands to the system browser, for flows Positron itself
// does not own.
//
// This is the sibling of externalUrl.ts, and the choice between them is about who opens the
// browser. When Positron runs the flow, `vscode.env.openExternal` reaches `shell.openExternal`
// in the Electron main process and externalUrl.ts patches it there. But a dependency running
// its own OAuth never touches that path: @databricks/sql's AuthorizationCode calls the `open`
// npm package directly, and its OAuthManager.getTokenU2M never passes the `openAuthUrl`
// override the SDK supports -- so there is no seam inside the process to patch.
//
// What `open` does expose is PATH. It spawns `open` (macOS) or `xdg-open` (Linux) with no
// shell, so PATH decides which binary runs; on Linux the bundled copy is skipped whenever
// `process.versions.electron` is set, which it is in the extension host. Putting our own
// executables ahead of the real ones therefore intercepts the launch.
//
// The shim records and swallows: nothing should spawn a real browser on a CI machine.
//
// Not supported on Windows, where `open` invokes PowerShell by absolute path and never
// consults PATH. Suites using this must leave off tags.WIN.

/** The shell shim. `open` detaches the child with stdio ignored, so record to a file, not stdout. */
const SHIM_SCRIPT = [
	'#!/bin/sh',
	'# Installed by browserLaunchShim.ts. Stands in for the OS browser opener so an SDK-owned',
	'# OAuth flow can be intercepted; records argv and exits without launching anything.',
	'printf \'%s\\n\' "$@" >> "$E2E_BROWSER_SHIM_CAPTURE"',
	'exit 0',
	'',
].join('\n');

export interface BrowserLaunchShim {
	/**
	 * Environment to merge into the launched app via `test.use({ extraEnv })`. Prepends the
	 * shim directory to PATH and points the shim at its capture file.
	 */
	readonly env: Record<string, string>;

	/**
	 * Discards anything a previous arm captured. Call this *before* the action that triggers
	 * the browser launch, so a URL from an earlier step cannot satisfy the next wait.
	 */
	arm(): void;

	/**
	 * Waits for a captured URL matching `pattern` and returns it.
	 *
	 * @param pattern Matched against each captured argument.
	 * @param timeout How long to wait for a match (default 60s -- this covers app startup and
	 * the driver's connect, which is slower than the in-process patch externalUrl.ts uses).
	 */
	waitForUrl(pattern: RegExp, timeout?: number): Promise<string>;

	/** Removes the shim directory. Safe to call more than once. */
	dispose(): void;
}

/**
 * Creates the shim on disk and returns a handle to it.
 *
 * Call this at module scope in the test file: `test.use({ extraEnv })` is evaluated when the
 * file is collected, so the PATH value has to exist by then. Each worker imports the file
 * separately and so gets its own directory, which is what we want -- two workers sharing one
 * capture file would read each other's URLs.
 */
export function createBrowserLaunchShim(): BrowserLaunchShim {
	const dir = mkdtempSync(join(tmpdir(), 'e2e-browser-shim-'));
	const capture = join(dir, 'captured-urls.txt');

	// Both names, so one shim covers macOS and Linux without branching on platform.
	for (const name of ['open', 'xdg-open']) {
		const shimPath = join(dir, name);
		writeFileSync(shimPath, SHIM_SCRIPT);
		chmodSync(shimPath, 0o755);
	}

	return {
		env: {
			PATH: `${dir}${delimiter}${process.env.PATH ?? ''}`,
			E2E_BROWSER_SHIM_CAPTURE: capture,
		},

		arm(): void {
			rmSync(capture, { force: true });
		},

		async waitForUrl(pattern: RegExp, timeout = 60_000): Promise<string> {
			let match: string | undefined;

			await expect.poll(() => {
				if (!existsSync(capture)) {
					return false;
				}
				match = readFileSync(capture, 'utf-8')
					.split('\n')
					.map(line => line.trim())
					.find(line => pattern.test(line));
				return match !== undefined;
			}, {
				timeout,
				// Do not report what was captured on failure: these URLs carry auth state.
				message: `Timed out waiting for a shimmed browser launch matching ${pattern}`,
			}).toBe(true);

			return match!;
		},

		dispose(): void {
			rmSync(dir, { recursive: true, force: true });
		},
	};
}
