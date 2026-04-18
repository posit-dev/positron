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
 * Scenario: an admin enforces `editor.formatOnSave` + Air as the default formatter via the
 * `[r]` language scope. Saving a messy `.R` file should trigger the Air formatter.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, tags, expect } from '../../_test.setup';

test.use({
	suiteId: __filename
});

const ENFORCED_SETTINGS_PATH = '/etc/rstudio/enforced-settings.json';
const PROFILES_PATH = '/etc/rstudio/profiles';
const PROFILES_BACKUP_PATH = '/etc/rstudio/profiles.enforced-settings-test.bak';
const WORKSPACE_PATH = '/home/user1/qa-example-content';
const TEST_FILE_NAME = 'enforced-settings-format-on-save.R';
const TEST_FILE_PATH = `${WORKSPACE_PATH}/${TEST_FILE_NAME}`;

// Deliberately messy R content that Air will reformat.
const MESSY_R_CONTENT = [
	'x<-1',
	'y  <-   2',
	'f <- function( x ){x+1}',
	'',
].join('\n');

const ENFORCED_SETTINGS_JSON = JSON.stringify({
	'[r]': {
		'editor.formatOnSave': true,
		'editor.defaultFormatter': 'posit.air-vscode',
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

		// Reconnect: the current Positron session is dead after the server restart.
		await app.positWorkbench.dashboard.goTo();
		try {
			await app.positWorkbench.dashboard.expectHeaderToBeVisible();
		} catch {
			// Need to re-authenticate.
			await app.positWorkbench.auth.signIn();
			await app.positWorkbench.dashboard.expectHeaderToBeVisible();
		}

		// Quit any leftover session (from before the restart) and open a fresh one,
		// so the new Positron process inherits POSITRON_ENFORCED_SETTINGS.
		try {
			await app.positWorkbench.dashboard.quitSession('qa-example-content');
		} catch {
			// No leftover session to quit.
		}
		await app.positWorkbench.dashboard.openSession('qa-example-content');

		await app.code.driver.page.waitForSelector('.monaco-workbench', { timeout: 60000 });
		await app.workbench.sessions.expectNoStartUpMessaging();
		await app.workbench.hotKeys.closeAllEditors();
	});

	test.afterAll('Remove enforced settings and restart session', async function ({ app, runDockerCommand }) {
		// Non-critical cleanup: removing temp files. Swallow errors here since a leftover
		// file in /etc/rstudio or the workspace won't affect other tests once the profile
		// is restored and the server is restarted.
		try {
			await runDockerCommand(
				`docker exec test sudo rm -f ${ENFORCED_SETTINGS_PATH} ${TEST_FILE_PATH}`,
				'Remove enforced settings file and test R file'
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

		// Reconnect so the worker-scoped teardown (which calls quitSession) has a live session.
		await app.positWorkbench.dashboard.goTo();
		try {
			await app.positWorkbench.dashboard.expectHeaderToBeVisible();
		} catch {
			await app.positWorkbench.auth.signIn();
			await app.positWorkbench.dashboard.expectHeaderToBeVisible();
		}
		await app.positWorkbench.dashboard.openSession('qa-example-content');
		await app.code.driver.page.waitForSelector('.monaco-workbench', { timeout: 60000 });
	});

	test('Verify [r]-scoped editor.formatOnSave triggers Air formatter', async function ({ app, runDockerCommand, hotKeys, page }) {

		await test.step('Write messy R file into the workspace', async () => {
			const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'messy-r-'));
			const tmpFile = path.join(tmpDir, TEST_FILE_NAME);
			await fs.promises.writeFile(tmpFile, MESSY_R_CONTENT);
			try {
				await runDockerCommand(
					`docker cp "${tmpFile}" test:${TEST_FILE_PATH}`,
					'Copy messy R file into container'
				);
				await runDockerCommand(
					`docker exec test chown user1:user1g ${TEST_FILE_PATH}`,
					'Chown messy R file'
				);
			} finally {
				await fs.promises.rm(tmpDir, { recursive: true, force: true });
			}
		});

		await test.step('Open the R file in Positron', async () => {
			await app.workbench.quickaccess.openFile(TEST_FILE_PATH);
			await expect(page.getByRole('tab', { name: TEST_FILE_NAME })).toBeVisible();
		});

		await test.step('Save the file to trigger formatOnSave', async () => {
			// Click the editor to ensure focus, then trigger save.
			await app.workbench.editor.editorPane.click();
			await hotKeys.save();
			// Give the formatter a moment to run and the save to complete.
			await page.waitForTimeout(2000);
		});

		await test.step('Verify the file on disk was reformatted by Air', async () => {
			await expect(async () => {
				const { stdout } = await runDockerCommand(
					`docker exec test cat ${TEST_FILE_PATH}`,
					'Read saved R file'
				);
				const saved = stdout;

				// The messy content should no longer be present verbatim - Air normalizes
				// spacing around `<-` and inside parentheses.
				expect(saved, 'file content should differ from the messy input after formatOnSave').not.toBe(
					MESSY_R_CONTENT
				);
				expect(saved, 'formatter should normalize `x<-1` to `x <- 1`').toContain('x <- 1');
				expect(saved, 'formatter should normalize `y  <-   2` to `y <- 2`').toContain('y <- 2');
			}).toPass({ timeout: 15000, intervals: [500, 1000, 2000] });
		});
	});
});
