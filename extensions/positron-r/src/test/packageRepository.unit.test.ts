/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import { resolveRRepositoryUrl } from '../packageRepository';
import { CondaMetadata, RVersionsMetadata } from '../r-installation';

const PUBLIC_CRAN_REPO = 'https://packagemanager.posit.co/cran/latest';
const INTERNAL_CRAN_REPO = 'https://ppm.internal.example.com/cran/latest';

const desktop = vscode.UIKind.Desktop;
const noReposConf = () => undefined;
const noFiles = () => undefined;

const rVersions = (repo?: string): RVersionsMetadata => ({ type: 'rversions', repo });

suite('resolveRRepositoryUrl', () => {

	teardown(async () => {
		const config = vscode.workspace.getConfiguration('positron.r');
		await config.update('defaultRepositories', undefined, vscode.ConfigurationTarget.Global);
		await config.update('packageManagerRepository', undefined, vscode.ConfigurationTarget.Global);
	});

	async function setRSetting(key: string, value: string): Promise<void> {
		await vscode.workspace.getConfiguration('positron.r').update(key, value, vscode.ConfigurationTarget.Global);
	}

	suite('r-versions Repo field', () => {

		test('a URL wins over every setting and over repos.conf', async () => {
			// The mechanism a Workbench administrator uses to pin each R build's
			// repository. It takes precedence at kernel launch, so it has to take
			// precedence here too, or the pane asks a different instance than the
			// session installs from.
			await setRSetting('defaultRepositories', 'posit-ppm');
			const boobyTrap = () => { throw new Error('repos.conf should not be consulted'); };

			assert.strictEqual(
				resolveRRepositoryUrl(rVersions(INTERNAL_CRAN_REPO), boobyTrap, noFiles, desktop),
				INTERNAL_CRAN_REPO,
			);
		});

		test('a file path is read as repos.conf', () => {
			const contents = ['# managed repositories', `CRAN = ${INTERNAL_CRAN_REPO}`].join('\n');

			assert.strictEqual(
				resolveRRepositoryUrl(rVersions('/etc/rstudio/repos.conf'), noReposConf, () => contents, desktop),
				INTERNAL_CRAN_REPO,
			);
		});

		test('an unreadable file path falls through to the settings precedence', async () => {
			await setRSetting('defaultRepositories', 'posit-ppm');

			assert.strictEqual(
				resolveRRepositoryUrl(rVersions('/etc/rstudio/missing.conf'), noReposConf, noFiles, desktop),
				PUBLIC_CRAN_REPO,
			);
		});

		test('metadata without a Repo field is ignored', () => {
			assert.strictEqual(resolveRRepositoryUrl(rVersions(), noReposConf, noFiles, desktop), undefined);
		});

		test('non-r-versions packager metadata is ignored', () => {
			const conda: CondaMetadata = { environmentPath: '/opt/conda/envs/r' };

			assert.strictEqual(resolveRRepositoryUrl(conda, noReposConf, noFiles, desktop), undefined);
		});
	});

	suite('settings precedence', () => {

		test('posit-ppm resolves to the public PPM CRAN repo without consulting repos.conf', async () => {
			await setRSetting('defaultRepositories', 'posit-ppm');
			const boobyTrap = () => { throw new Error('repos.conf should not be consulted'); };

			assert.strictEqual(resolveRRepositoryUrl(undefined, boobyTrap, noFiles, desktop), PUBLIC_CRAN_REPO);
		});

		test('rstudio and none cannot point at a PPM', async () => {
			await setRSetting('defaultRepositories', 'rstudio');
			assert.strictEqual(resolveRRepositoryUrl(undefined, noReposConf, noFiles, desktop), undefined);

			await setRSetting('defaultRepositories', 'none');
			assert.strictEqual(resolveRRepositoryUrl(undefined, noReposConf, noFiles, desktop), undefined);
		});

		test('auto takes the CRAN entry from repos.conf, skipping comments and non-URL lines', async () => {
			await setRSetting('defaultRepositories', 'auto');
			const contents = [
				'# managed repositories',
				'not a key-value line',
				'Internal = file:///opt/local-repo',
				'Extra = https://other.example.com/cran/latest',
				`CRAN = ${INTERNAL_CRAN_REPO}`,
			].join('\n');

			assert.strictEqual(
				resolveRRepositoryUrl(undefined, () => '/etc/rstudio/repos.conf', () => contents, desktop),
				INTERNAL_CRAN_REPO,
			);
		});

		test('auto falls back to the first http(s) entry when repos.conf has no CRAN key', async () => {
			await setRSetting('defaultRepositories', 'auto');
			const contents = ['Internal = file:///opt/local-repo', 'Extra = https://other.example.com/cran/latest'].join('\n');

			assert.strictEqual(
				resolveRRepositoryUrl(undefined, () => '/etc/rstudio/repos.conf', () => contents, desktop),
				'https://other.example.com/cran/latest',
			);
		});

		test('auto uses the Package Manager Repository setting when there is no repos.conf, stripping a trailing slash', async () => {
			await setRSetting('defaultRepositories', 'auto');
			await setRSetting('packageManagerRepository', `${INTERNAL_CRAN_REPO}/`);

			assert.strictEqual(resolveRRepositoryUrl(undefined, noReposConf, noFiles, desktop), INTERNAL_CRAN_REPO);
		});

		test('auto resolves to nothing on the desktop with no configuration, since ark uses cran.rstudio.com', async () => {
			await setRSetting('defaultRepositories', 'auto');

			assert.strictEqual(resolveRRepositoryUrl(undefined, noReposConf, noFiles, desktop), undefined);
		});

		test('auto resolves to the public PPM in web mode with no configuration', async () => {
			await setRSetting('defaultRepositories', 'auto');

			assert.strictEqual(
				resolveRRepositoryUrl(undefined, noReposConf, noFiles, vscode.UIKind.Web),
				PUBLIC_CRAN_REPO,
			);
		});
	});
});
