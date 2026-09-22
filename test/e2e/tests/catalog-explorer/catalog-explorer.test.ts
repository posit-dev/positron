/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Locator, Page } from '@playwright/test';
import { test, expect, tags } from '../_test.setup';

// Host directory the Snowflake case writes connections.toml to. Created at module scope (once per
// worker) so the `extraSettings` override below can name it before the app starts. Kept out of the
// workspace folder, which is a git checkout the teardown checks for stray files.
const snowflakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'positron-e2e-snowflake-'));

// On Workbench the extension host runs inside the `test` container, which cannot see the host
// filesystem, so connections.toml is copied into the container and the setting points at this
// path instead. `docker cp` needs the container name; the fixture keeps its own copy private.
const WORKBENCH_CONTAINER = 'test';
const WORKBENCH_SNOWFLAKE_HOME = '/home/user1/.snowflake';

test.use({
	suiteId: __filename,
	// Baked into the user settings before the app starts (and, on Workbench, copied into the
	// container with them), so no restart is needed on any platform. The Snowflake provider reads
	// only the directory this setting names, so it has to be one the extension host can read.
	extraSettings: async ({ }, use, workerInfo) => {
		const isWorkbench = workerInfo.project.name === 'e2e-workbench';
		await use({
			'catalogExplorer.enabled': true,
			'catalogExplorer.snowflakeConnections': isWorkbench ? WORKBENCH_SNOWFLAKE_HOME : snowflakeHome,
		});
	},
});

const workspace = process.env.DATABRICKS_WORKSPACE || 'workspace';
const pat = process.env.DATABRICKS_PAT || 'dummypat';

// The named connection the Snowflake case writes to connections.toml and then picks from the
// provider's quick pick. Not a secret; it is only a label for the profile.
const snowflakeConnectionName = 'positron_e2e';

// Ground truth for the Snowflake tree assertion. This is a Snowflake Marketplace share rather
// than anything a person created in the account, so its shape is stable; the connections and
// data-connections Snowflake suites assert on the same database.
const snowflakeDatabase = 'FINANCIAL__ECONOMIC_ESSENTIALS';

test.describe('Catalog Explorer', {
	tag: [tags.CATALOG_EXPLORER, tags.WEB, tags.WIN, tags.WORKBENCH],
}, () => {

	// Each case leaves its provider expanded, and the Explorer sidebar gives the section only a few
	// rows. The tree is virtualized, so anything pushed below them is not rendered at all, and the
	// next case's databases would sit under the previous case's catalogs forever. Collapse everything
	// so each case starts from one row per provider. The toolbar only shows while the section is
	// hovered or focused, hence the hover first; the button is absent while the tree is empty.
	test.afterEach(async function ({ app }) {
		const page = app.code.driver.currentPage;
		await page.getByRole('button', { name: 'Catalog Explorer Section' }).hover();
		const collapseAll = page
			.getByRole('toolbar', { name: 'Catalog Explorer actions' })
			.getByRole('button', { name: 'Collapse All' });
		if (await collapseAll.isVisible()) {
			await collapseAll.click();
		}
	});

	test.afterAll(async function ({ runDockerCommand }, testInfo) {
		fs.rmSync(snowflakeHome, { recursive: true, force: true });

		// Other suites share the Workbench container, so do not leave the credentials behind.
		if (testInfo.project.name === 'e2e-workbench') {
			await runDockerCommand(
				`docker exec ${WORKBENCH_CONTAINER} rm -f ${WORKBENCH_SNOWFLAKE_HOME}/connections.toml`,
				'Remove the Snowflake connections file from the container'
			);
		}
	});

	/**
	 * Expand the Catalog Explorer section of the Explorer sidebar if it is collapsed.
	 *
	 * The tree only fetches and renders its nodes while the section is expanded, so a provider added
	 * behind a collapsed header never shows up, however quickly it authenticated. The header click is
	 * a toggle, so it is guarded on the current state rather than clicked unconditionally; otherwise
	 * the second test in this file would collapse what the first one opened.
	 */
	async function expandCatalogExplorerSection(page: Page): Promise<void> {
		const section = page.getByRole('button', { name: 'Catalog Explorer Section' });
		if (await section.getAttribute('aria-expanded') !== 'true') {
			await section.click();
		}
		await expect(section).toHaveAttribute('aria-expanded', 'true');
	}

	/**
	 * Scroll the virtualized Catalog Explorer tree until `row` is rendered.
	 *
	 * The tree renders only the rows that fit the section, so a row below the fold is absent from
	 * the DOM and no wait would ever find it. Wheels to the top, then down in steps; when a pass
	 * reaches the end without finding the row, the rows are still loading, so it starts over from
	 * the top rather than leaving the tree stranded at the bottom. Gives up at `timeout`, leaving
	 * the caller's assertion to report the row as missing.
	 */
	async function revealTreeRow(page: Page, tree: Locator, row: Locator, timeout = 60000): Promise<void> {
		// Enough wheel steps to cover well over a hundred rows before restarting the pass.
		const stepsPerPass = 40;
		const deadline = Date.now() + timeout;
		while (await row.count() === 0 && Date.now() < deadline) {
			await tree.hover();
			await page.mouse.wheel(0, -100000);
			for (let i = 0; i < stepsPerPass && await row.count() === 0; i++) {
				await page.mouse.wheel(0, 200);
				await page.waitForTimeout(100);
			}
		}
	}

	test('Verify Basic Databricks Catalog Explorer functionality', async function ({ app, python }) {

		await expandCatalogExplorerSection(app.code.driver.currentPage);

		await app.code.driver.currentPage.getByText('Configure a Catalog Provider').click();

		await app.workbench.quickInput.waitForQuickInputOpened();
		await app.workbench.quickInput.type('Databricks');
		await app.workbench.quickInput.selectQuickInputElement(0, true);

		await app.workbench.quickInput.type(workspace);
		await app.code.driver.currentPage.keyboard.press('Enter');
		await app.workbench.quickInput.type(pat);
		await app.code.driver.currentPage.keyboard.press('Enter');

		await expect(app.code.driver.currentPage.locator('.label-name').filter({ hasText: 'main' })).toBeVisible();
		await expect(app.code.driver.currentPage.locator('.label-name').filter({ hasText: 'samples' })).toBeVisible();
		await expect(app.code.driver.currentPage.locator('.label-name').filter({ hasText: 'system' })).toBeVisible();
		await expect(app.code.driver.currentPage.locator('.label-name').filter({ hasText: 'workshops' })).toBeVisible();

		// cannot see dialog that doubles checks if removal is wanted in e2e tests
		// await app.code.driver.currentPage.getByText(workspace.replace('https://','')).hover();
		// await app.code.driver.currentPage.locator('.action-label[aria-label*="Remove Catalog Provider"]').click();

	});

	test('Verify Basic Snowflake Catalog Explorer functionality', async function ({ app, runDockerCommand }, testInfo) {

		// Read the credentials at runtime, not at module scope: `.env.e2e` is applied by the auto
		// `envVars` worker fixture, which runs after this file is evaluated during collection. The
		// Linux lanes export the login as SNOWFLAKE_USER and the Workbench lane as SNOWFLAKE_USERNAME;
		// each pairs with the SNOWFLAKE_PASSWORD exported alongside it.
		const account = process.env.SNOWFLAKE_ACCOUNT;
		const user = process.env.SNOWFLAKE_USERNAME || process.env.SNOWFLAKE_USER;
		const password = process.env.SNOWFLAKE_PASSWORD;

		// Where these are not provisioned (no .env locally) the sign-in cannot happen, so skip rather
		// than fail, as the data-connections suites do.
		test.skip(!account || !user || !password,
			'Snowflake test credentials not configured (SNOWFLAKE_ACCOUNT / SNOWFLAKE_USERNAME or SNOWFLAKE_USER / SNOWFLAKE_PASSWORD unset)');

		// The Snowflake provider takes no credentials interactively; it lists the named connections
		// in connections.toml and authenticates with whatever the chosen entry holds. The
		// authenticator is set explicitly because the provider defaults to externalbrowser, which
		// would launch a real browser for an Okta sign-in and stall the run. The password is the
		// IDE service account's programmatic access token, which Snowflake accepts wherever a
		// password is expected.
		const connectionsFile = path.join(snowflakeHome, 'connections.toml');
		fs.writeFileSync(connectionsFile, [
			`[${snowflakeConnectionName}]`,
			`account = "${account}"`,
			`user = "${user}"`,
			`password = "${password}"`,
			'authenticator = "snowflake"',
			'',
		].join('\n'));

		// See WORKBENCH_SNOWFLAKE_HOME: the container reads its own copy of the file.
		if (testInfo.project.name === 'e2e-workbench') {
			await runDockerCommand(
				`docker exec ${WORKBENCH_CONTAINER} mkdir -p ${WORKBENCH_SNOWFLAKE_HOME}`,
				'Create the Snowflake config directory in the container'
			);
			await runDockerCommand(
				`docker cp "${connectionsFile}" ${WORKBENCH_CONTAINER}:${WORKBENCH_SNOWFLAKE_HOME}/connections.toml`,
				'Copy connections.toml into the container'
			);
			// `docker cp` lands the file as root; the session runs as user1.
			await runDockerCommand(
				`docker exec ${WORKBENCH_CONTAINER} chown -R user1 ${WORKBENCH_SNOWFLAKE_HOME}`,
				'Set ownership of the Snowflake config directory'
			);
		}

		await expandCatalogExplorerSection(app.code.driver.currentPage);

		// The welcome view's "Configure a Catalog Provider" link is gone once the Databricks case
		// has registered a provider, so add this one through the command instead.
		await app.workbench.quickaccess.runCommand('posit.catalog-explorer.addCatalogProvider', { keepOpen: true });
		await app.workbench.quickInput.type('Snowflake');
		await app.workbench.quickInput.selectQuickInputElement(0, true);

		// Second picker: the connection profiles read from connections.toml.
		await app.workbench.quickInput.selectQuickInputElementContaining(snowflakeConnectionName);

		// Scope to the tree: the closed quick pick keeps a hidden "Snowflake" row in the DOM, and an
		// unscoped `.label-name` match resolves to that row and reports hidden until the timeout.
		const tree = app.code.driver.currentPage.getByRole('tree', { name: 'Catalog Explorer' });

		// Provider nodes render expanded, so the databases appear without a click once the SDK has
		// authenticated. The extension's own auth timeout is 30s; leave room for it plus the first
		// metadata query.
		await expect(tree.locator('.label-name').filter({ hasText: 'Snowflake' })).toBeVisible();

		// The service account's role sees several dozen databases, listed alphabetically, and the
		// section shows only a few rows (see afterEach), so the one asserted on sits below the fold
		// where the virtualized tree does not render it at all. Scroll it into the rendered range
		// before asserting on it.
		const databaseRow = tree.locator('.label-name').filter({ hasText: snowflakeDatabase });
		await revealTreeRow(app.code.driver.currentPage, tree, databaseRow);
		await expect(databaseRow).toBeVisible();

	});
});
