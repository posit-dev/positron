/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Verifies that language-scoped keys in POSITRON_ENFORCED_SETTINGS (e.g. `[r]`) are applied.
 *
 * Regression test for posit-dev/positron#12380 - language-scoped enforced settings were
 * silently dropped during configuration resolution. Fixed upstream in
 * rstudio/vscode-server#343.
 *
 * Enforced config for the whole suite (exercises both coexistence and scope):
 *   {
 *     "editor.formatOnSave": false,
 *     "[r]": { "editor.formatOnSave": true, "editor.defaultFormatter": "Posit.air-vscode" }
 *   }
 *
 * Covers:
 *   1. Positive scope: saving a messy `.R` file triggers the Air formatter.
 *   2. Negative scope / coexistence: saving a `.py` file does NOT format (top-level `false`
 *      still applies; the `[r]` override did not leak globally).
 *   3. Enforced-wins-over-user: with a conflicting `[r]: { formatOnSave: false }` in the
 *      user's settings.json, a messy `.R` file still formats on save.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, tags, expect } from '../../_test.setup';
import { Application } from '../../../infra/application.js';

test.use({
	suiteId: __filename
});

const ENFORCED_SETTINGS_PATH = '/etc/rstudio/enforced-settings.json';
const PROFILES_PATH = '/etc/rstudio/profiles';
const PROFILES_BACKUP_PATH = '/etc/rstudio/profiles.enforced-settings-test.bak';
const WORKSPACE_PATH = '/home/user1/qa-example-content';
const USER_SETTINGS_PATH = '/home/user1/.positron-server/User/settings.json';
const USER_SETTINGS_BACKUP_PATH = '/home/user1/.positron-server/User/settings.json.enforced-settings-test.bak';

// Deliberately messy R content that Air will reformat.
const MESSY_R_CONTENT = [
	'x<-1',
	'y  <-   2',
	'f <- function( x ){x+1}',
	'',
].join('\n');

// Deliberately messy Python content. We assert this is NOT reformatted on save,
// so the exact contents don't matter as long as no built-in formatter would touch it.
const MESSY_PY_CONTENT = [
	'x=1',
	'y   =   2',
	'def f(  x  ):return x+1',
	'',
].join('\n');

// Top-level `formatOnSave: false` + `[r]` override. Together these let one config
// exercise (a) the `[r]` scope applying to R files, (b) the top-level `false` still
// applying to non-R files - i.e. the `[r]` override did not leak globally.
const ENFORCED_SETTINGS_JSON = JSON.stringify({
	'editor.formatOnSave': false,
	'[r]': {
		'editor.formatOnSave': true,
		'editor.defaultFormatter': 'Posit.air-vscode',
	},
}, null, 2);

const PROFILES_CONTENT = `[*]\npositron-enforced-settings = ${ENFORCED_SETTINGS_PATH}\n`;

test.describe('Workbench: Language-scoped enforced settings', {
	tag: [tags.WORKBENCH],
}, () => {

	test.beforeAll('Configure [r]-scoped enforced settings and restart session', async function ({ app, runDockerCommand }) {
		// Write files on the host, then `docker cp` into the container. This avoids
		// brittle multi-layer shell quoting for JSON payloads.
		const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'enforced-settings-'));
		const tmpSettings = path.join(tmpDir, 'enforced-settings.json');
		const tmpProfiles = path.join(tmpDir, 'profiles');
		await fs.promises.writeFile(tmpSettings, ENFORCED_SETTINGS_JSON);
		await fs.promises.writeFile(tmpProfiles, PROFILES_CONTENT);

		try {
			// Ensure /etc/rstudio exists - the profiles file and enforced-settings.json
			// are not guaranteed to be present in the test container.
			await runDockerCommand(
				`docker exec test sudo mkdir -p /etc/rstudio`,
				'Ensure /etc/rstudio directory exists'
			);

			// Back up the existing profiles file (if present) so we can restore it on teardown.
			await runDockerCommand(
				`docker exec test bash -lc 'if [ -f ${PROFILES_PATH} ]; then sudo cp ${PROFILES_PATH} ${PROFILES_BACKUP_PATH}; fi'`,
				'Back up existing profiles file'
			);

			// Copy enforced-settings.json into a user-writable location, then sudo-move it to /etc/rstudio.
			await runDockerCommand(
				`docker cp "${tmpSettings}" test:/tmp/enforced-settings.json`,
				'Copy enforced-settings.json into container'
			);
			await runDockerCommand(
				`docker exec test sudo mv /tmp/enforced-settings.json ${ENFORCED_SETTINGS_PATH}`,
				'Install enforced-settings.json'
			);

			await runDockerCommand(
				`docker cp "${tmpProfiles}" test:/tmp/profiles`,
				'Copy profiles into container'
			);
			await runDockerCommand(
				`docker exec test sudo mv /tmp/profiles ${PROFILES_PATH}`,
				'Install profiles'
			);
		} finally {
			await fs.promises.rm(tmpDir, { recursive: true, force: true });
		}

		// Restart rstudio-server so the new profile + enforced settings take effect.
		// New Positron sessions launched after this will have POSITRON_ENFORCED_SETTINGS set.
		await runDockerCommand(
			`docker exec test sudo rstudio-server restart`,
			'Restart rstudio-server'
		);

		// `rstudio-server restart` returns before the server is accepting connections again;
		// poll until the dashboard responds from the host.
		await waitForRStudioServerReady();

		// The restart terminates every session, so there is nothing to quit - just open a fresh
		// one so the new Positron process inherits POSITRON_ENFORCED_SETTINGS. We must reconnect
		// and open without idling in between: on local Docker Desktop the homepage's websocket is
		// reaped while idle (rserver logs "Broken pipe" on the connection upgrade), which re-raises
		// the "Disconnected from Workbench" modal and hides the "Create new session" button. So
		// reconnect immediately before opening, and retry the pair if the connection flaps.
		await expect(async () => {
			await reconnectDashboard(app);
			await app.positWorkbench.dashboard.openSession('qa-example-content');
		}).toPass({ timeout: 180000, intervals: [1000, 2000, 5000] });

		await app.code.driver.currentPage.waitForSelector('.monaco-workbench', { timeout: 60000 });
		await app.workbench.sessions.expectNoStartUpMessaging();
		await app.workbench.hotKeys.closeAllEditors();
	});

	test.afterAll('Remove enforced settings and restart session', async function ({ app, runDockerCommand }) {
		// Non-critical cleanup: removing temp files and restoring user settings. Swallow
		// errors here since a leftover file in /etc/rstudio or the workspace won't affect
		// other tests once the profile is restored and the server is restarted.
		try {
			await runDockerCommand(
				`docker exec test bash -lc 'sudo rm -f ${ENFORCED_SETTINGS_PATH}; rm -f ${WORKSPACE_PATH}/enforced-settings-*.R ${WORKSPACE_PATH}/enforced-settings-*.py'`,
				'Remove enforced settings file and test files'
			);
			// Restore user settings.json if we backed one up during a test.
			await runDockerCommand(
				`docker exec test bash -lc 'if [ -f ${USER_SETTINGS_BACKUP_PATH} ]; then mv ${USER_SETTINGS_BACKUP_PATH} ${USER_SETTINGS_PATH}; fi'`,
				'Restore user settings.json (if backup exists)'
			);
		} catch (error) {
			console.warn('Non-critical teardown cleanup failed (continuing):', error);
		}

		// Critical cleanup: any failure here leaves the container with enforced settings
		// active, which will contaminate subsequent test runs. Let these throw.
		await runDockerCommand(
			`docker exec test bash -lc 'if [ -f ${PROFILES_BACKUP_PATH} ]; then sudo mv ${PROFILES_BACKUP_PATH} ${PROFILES_PATH}; else sudo rm -f ${PROFILES_PATH}; fi'`,
			'Restore original profiles file'
		);
		await runDockerCommand(
			`docker exec test sudo rstudio-server restart`,
			'Restart rstudio-server to drop enforced settings'
		);

		// Wait for the server to accept connections again. The worker-scoped teardown
		// (WorkbenchApp.stop) will then navigate to the dashboard and attempt to quit the
		// session itself. Its goTo + quitSession are already wrapped in try/catch and just
		// warn on failure, so we don't need to reopen a session here - doing so would
		// introduce a UI state (project shown as button after a server restart killed the
		// session) that openSession's locator chain doesn't handle.
		await waitForRStudioServerReady();
	});

	test.beforeAll('Wait for Air bootstrap extension to be installed', async function ({ runDockerCommand }) {
		// Air is a bootstrap extension that is downloaded lazily after container startup
		// (not bundled in positron-workbench-linux-x64-branch.tar.gz). Without this, the
		// formatter lookup on save silently no-ops.
		await waitForAirExtensionInstalled(runDockerCommand);
	});

	test('`[r]` scope: messy .R file is reformatted by Air on save', async function ({ app, runDockerCommand, hotKeys, page }) {
		const filePath = await writeOpenAndSave(app, runDockerCommand, hotKeys, page, 'enforced-settings-format-r.R', MESSY_R_CONTENT);

		await expect(async () => {
			const saved = await readContainerFile(runDockerCommand, filePath);
			expect(saved, 'file content should differ from the messy input after formatOnSave').not.toBe(MESSY_R_CONTENT);
			expect(saved, 'formatter should normalize `x<-1` to `x <- 1`').toContain('x <- 1');
			expect(saved, 'formatter should normalize `y  <-   2` to `y <- 2`').toContain('y <- 2');
		}).toPass({ timeout: 15000, intervals: [500, 1000, 2000] });
	});

	test('`[r]` does not leak globally: messy .py file is NOT reformatted on save', async function ({ app, runDockerCommand, hotKeys, page }) {
		// Enforced config has top-level `formatOnSave: false` plus a `[r]` override. For a
		// Python file, formatOnSave should resolve to the top-level `false`. If the fix
		// regressed and the `[r]` block leaked globally, `formatOnSave: true` + Air as
		// the default formatter would apply to Python too - a noticeable file change.
		const filePath = await writeOpenAndSave(app, runDockerCommand, hotKeys, page, 'enforced-settings-no-format-py.py', MESSY_PY_CONTENT);

		const saved = await readContainerFile(runDockerCommand, filePath);
		expect(saved, 'python file should be unchanged on save (no `[python]` policy; top-level `false` applies)').toBe(MESSY_PY_CONTENT);
	});

	test('Enforced setting wins over conflicting user setting', async function ({ app, runDockerCommand, hotKeys, page }) {
		// Merge a conflicting `[r]: { formatOnSave: false }` into the existing user
		// settings.json. Merging (rather than overwriting) is critical - the workbench
		// test fixture pre-seeds settings.json with workspace-trust disablers like
		// `"security.workspace.trust.enabled": false`, and losing those triggers a trust
		// prompt that blocks the rest of the test.
		await test.step('Merge a conflicting `[r]` setting into user settings.json', async () => {
			await runDockerCommand(
				`docker exec test bash -lc 'if [ -f ${USER_SETTINGS_PATH} ] && [ ! -f ${USER_SETTINGS_BACKUP_PATH} ]; then cp ${USER_SETTINGS_PATH} ${USER_SETTINGS_BACKUP_PATH}; fi'`,
				'Back up user settings.json (if not already)'
			);

			const { stdout: currentStr } = await runDockerCommand(
				`docker exec test bash -lc 'cat ${USER_SETTINGS_PATH} 2>/dev/null || echo "{}"'`,
				'Read current user settings.json'
			);
			const current = currentStr.trim() ? JSON.parse(currentStr) : {};
			const merged = {
				...current,
				'[r]': { ...(current['[r]'] ?? {}), 'editor.formatOnSave': false },
			};

			const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'user-settings-'));
			const tmpFile = path.join(tmpDir, 'settings.json');
			await fs.promises.writeFile(tmpFile, JSON.stringify(merged, null, 2));
			try {
				await runDockerCommand(
					`docker cp "${tmpFile}" test:${USER_SETTINGS_PATH}`,
					'Install merged user settings.json'
				);
				// `docker cp` writes the file as root; the Positron session runs as user1 and must
				// be able to write settings.json (otherwise saving fails with EACCES). Restore
				// ownership the same way writeOpenAndSave() does for files it copies in.
				await runDockerCommand(
					`docker exec test chown user1:user1g ${USER_SETTINGS_PATH}`,
					'Restore ownership of user settings.json'
				);
			} finally {
				await fs.promises.rm(tmpDir, { recursive: true, force: true });
			}

			// VS Code watches settings.json, but reloading makes the observation deterministic.
			await hotKeys.reloadWindow();
			await app.code.driver.currentPage.waitForSelector('.monaco-workbench', { timeout: 60000 });
		});

		const filePath = await writeOpenAndSave(app, runDockerCommand, hotKeys, page, 'enforced-settings-user-conflict.R', MESSY_R_CONTENT);

		await expect(async () => {
			const saved = await readContainerFile(runDockerCommand, filePath);
			expect(saved, 'enforced [r] formatOnSave should win over user `[r]: { formatOnSave: false }`').not.toBe(MESSY_R_CONTENT);
			expect(saved, 'Air should still normalize `x<-1` despite conflicting user setting').toContain('x <- 1');
		}).toPass({ timeout: 15000, intervals: [500, 1000, 2000] });
	});
});

/**
 * Write a file into the workspace, open it in Positron, and save it. Returns the file's
 * absolute path in the container.
 */
async function writeOpenAndSave(
	app: Application,
	runDockerCommand: RunDockerCommand,
	hotKeys: { save: () => Promise<void> },
	page: import('@playwright/test').Page,
	fileName: string,
	content: string,
): Promise<string> {
	const filePath = `${WORKSPACE_PATH}/${fileName}`;

	await test.step(`Write ${fileName} into the workspace`, async () => {
		const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'enforced-settings-file-'));
		const tmpFile = path.join(tmpDir, fileName);
		await fs.promises.writeFile(tmpFile, content);
		try {
			await runDockerCommand(`docker cp "${tmpFile}" test:${filePath}`, `Copy ${fileName} into container`);
			await runDockerCommand(`docker exec test chown user1:user1g ${filePath}`, `Chown ${fileName}`);
		} finally {
			await fs.promises.rm(tmpDir, { recursive: true, force: true });
		}
	});

	await test.step(`Open ${fileName} in Positron`, async () => {
		await app.workbench.quickaccess.openFile(filePath);
		await expect(page.getByRole('tab', { name: fileName })).toBeVisible();
	});

	await test.step('Save to trigger formatOnSave (if applicable)', async () => {
		await app.workbench.editor.editorPane.click();
		// Give language-server-backed formatters (e.g. Air for R) time to activate and
		// register their formatter before the save keystroke.
		await page.waitForTimeout(5000);
		await hotKeys.save();
		// Give the save (and any format-on-save) a moment to land on disk. For format tests
		// callers additionally poll with expect.toPass; this baseline wait prevents the
		// NOT-formatted case from racing and reading an empty / pre-save file.
		await page.waitForTimeout(2000);
	});

	return filePath;
}

/** Read a file from the workbench container via `docker exec cat`. */
async function readContainerFile(runDockerCommand: RunDockerCommand, filePath: string): Promise<string> {
	const { stdout } = await runDockerCommand(`docker exec test cat ${filePath}`, `Read ${filePath}`);
	return stdout;
}

type RunDockerCommand = (command: string, description: string) => Promise<{ stdout: string; stderr: string }>;

/**
 * Poll rstudio-server until the login page is reachable *from the host* (the same network
 * path the browser uses), returning a 2xx/3xx.
 *
 * `rstudio-server restart` returns before the listener is back, so navigating immediately
 * yields ERR_CONNECTION_RESET. Probing via `docker exec ... curl localhost:8787` only proves
 * the in-container loopback is up; on Docker Desktop the host-side port-forward can lag that
 * by several seconds, so the probe reports ready while the browser still hits a dead
 * connection and shows a "Disconnected from Workbench" modal. Probing from the host (where
 * Playwright runs) closes that gap.
 */
async function waitForRStudioServerReady(timeoutMs = 60000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	let lastError: unknown;
	while (Date.now() < deadline) {
		try {
			const response = await fetch('http://localhost:8787/auth-sign-in', { redirect: 'manual' });
			if (response.status >= 200 && response.status < 400) {
				return;
			}
		} catch (error) {
			lastError = error;
		}
		await new Promise(resolve => setTimeout(resolve, 1000));
	}
	throw new Error(`rstudio-server did not become reachable from the host within ${timeoutMs}ms${lastError ? `: ${lastError}` : ''}`);
}

/**
 * Poll the container's user-extensions directory until the Air bootstrap extension shows up.
 * Air is downloaded lazily from the marketplace after container startup and is required for
 * the `posit.air-vscode` formatter to exist.
 */
async function waitForAirExtensionInstalled(runDockerCommand: RunDockerCommand, timeoutMs = 120000): Promise<void> {
	const extensionsDir = '/home/user1/.positron-server/extensions';
	const deadline = Date.now() + timeoutMs;
	let lastListing = '';
	while (Date.now() < deadline) {
		try {
			const { stdout } = await runDockerCommand(
				`docker exec test bash -lc 'ls -1 ${extensionsDir} 2>/dev/null || true'`,
				'List installed extensions'
			);
			lastListing = stdout;
			if (/(^|\n)\s*posit\.air-vscode[^\n]*/i.test(stdout)) {
				return;
			}
		} catch {
			// ignore and retry
		}
		await new Promise(resolve => setTimeout(resolve, 2000));
	}
	throw new Error(
		`Air extension (posit.air-vscode) was not installed in ${extensionsDir} within ${timeoutMs}ms.\n` +
		`Last directory listing:\n${lastListing}`
	);
}

/**
 * Re-establish a live dashboard connection after `rstudio-server restart`.
 *
 * The restart leaves the already-open page unable to recover on its own: the HTTP front-end
 * answers (waitForRStudioServerReady passes) before the backend can accept the homepage's
 * websocket, so the client enters a long reconnect backoff and shows a blocking "Disconnected
 * from Workbench" modal. The modal's "Retry Now" button only resumes that same dead socket, and
 * the restart can also invalidate the session cookie. So instead of retrying the stale page we
 * fully re-navigate (which opens a fresh websocket and lands on sign-in if re-auth is needed)
 * and loop until the dashboard is genuinely connected - no modal, header visible.
 */
async function reconnectDashboard(app: Application): Promise<void> {
	const page = app.code.driver.currentPage;
	const dashboard = app.positWorkbench.dashboard;
	const disconnected = page.getByRole('alertdialog', { name: 'Disconnected from Workbench' });

	await expect(async () => {
		// Fresh navigation: a brand-new connection, not a retry of the backed-off socket.
		await page.goto('http://localhost:8787');

		// A restart can invalidate the session cookie, so a fresh load may land on sign-in.
		if (!(await dashboard.title.isVisible().catch(() => false))) {
			await app.positWorkbench.auth.signIn().catch(() => { });
		}

		// The dashboard is only usable once the disconnect modal is gone and the header is up.
		await expect(disconnected).toBeHidden({ timeout: 2000 });
		await dashboard.expectHeaderToBeVisible();
	}).toPass({ timeout: 120000, intervals: [2000, 5000, 5000, 10000] });
}
