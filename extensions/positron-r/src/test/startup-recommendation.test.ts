/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './mocha-setup';

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as positron from 'positron';
import * as vscode from 'vscode';
import { runtimeManager } from '../extension';
import { currentRInstallation, looksLikeRProject, makeMetadata, rFullSearchTriggers, rRuntimeDiscoverer } from '../provider';
import * as testKit from './kit';

/** Every record the R search yields, in order. */
async function searchAll(): Promise<positron.LanguageRuntimeMetadata[]> {
	const runtimes: positron.LanguageRuntimeMetadata[] = [];
	for await (const runtime of rRuntimeDiscoverer()) {
		runtimes.push(runtime);
	}
	return runtimes;
}

// The tests that call the R search run the real search, so they need R installed.
suite('R startup recommendation', () => {
	test('the search never asks for R to start right away', async () => {
		const runtimes = await searchAll();
		assert.ok(runtimes.length > 0, 'expected the search to find R');
		assert.deepStrictEqual(
			runtimes.map(runtime => runtime.startupBehavior),
			runtimes.map(() => positron.LanguageRuntimeStartupBehavior.Implicit),
		);
	});

	test('the quick path picks the R the search lists first, with the same runtime ID', async function () {
		const current = await currentRInstallation();
		if (!current?.usable) {
			this.skip();
		}
		const quick = await makeMetadata(current);
		const [first] = await searchAll();
		assert.strictEqual(quick.runtimeId, first.runtimeId);
	});

	test('validateMetadata keeps the saved startup behavior', async () => {
		const [saved] = await searchAll();
		const validated = await Promise.all([
			positron.LanguageRuntimeStartupBehavior.Implicit,
			positron.LanguageRuntimeStartupBehavior.Immediate,
		].map(async startupBehavior => (await runtimeManager.validateMetadata({ ...saved, startupBehavior })).startupBehavior));
		assert.deepStrictEqual(validated, [
			positron.LanguageRuntimeStartupBehavior.Implicit,
			positron.LanguageRuntimeStartupBehavior.Immediate,
		]);
	});

	// This suite opens no folder, so the test points looksLikeRProject() at a temp folder.
	test('looksLikeRProject skips R files in folders of installed packages and environments', async () => {
		await testKit.withDisposables(async disposables => {
			const [folder, folderDisposable] = testKit.makeTempDir('r-project-check');
			disposables.push(folderDisposable);
			const write = (relativePath: string) => {
				const file = path.join(folder, relativePath);
				fs.mkdirSync(path.dirname(file), { recursive: true });
				fs.writeFileSync(file, '');
			};

			// The README means the folder isn't empty, so whether you use RStudio doesn't matter.
			write('README.md');
			const results: Record<string, boolean> = {};
			for (const skipped of ['node_modules', '.venv', 'venv', '.virtualenv', '.conda', '.pixi']) {
				write(`${skipped}/lib/example.R`);
				results[skipped] = await looksLikeRProject(vscode.Uri.file(folder));
				fs.rmSync(path.join(folder, skipped), { recursive: true, force: true });
			}
			write('scripts/analysis.R');
			results.scripts = await looksLikeRProject(vscode.Uri.file(folder));
			assert.deepStrictEqual(results, {
				'node_modules': false,
				'.venv': false,
				'venv': false,
				'.virtualenv': false,
				'.conda': false,
				'.pixi': false,
				'scripts': true,
			});
		});
	});

	// The r-versions file trigger reads a system file, so only the settings are checked here.
	suite('full search triggers', () => {
		const rConfig = () => vscode.workspace.getConfiguration('positron.r');
		const modulesConfig = () => vscode.workspace.getConfiguration('positron.environmentModules');

		teardown(async () => {
			await rConfig().update('interpreters.override', undefined, vscode.ConfigurationTarget.Global);
			await modulesConfig().update('environments', undefined, vscode.ConfigurationTarget.Global);
			await modulesConfig().update('enabled', undefined, vscode.ConfigurationTarget.Global);
		});

		test('the override list is set when it lists a path', async () => {
			const before = rFullSearchTriggers().overrideListSet;
			await rConfig().update('interpreters.override', ['/opt/R/4.4.1/bin/R'], vscode.ConfigurationTarget.Global);
			assert.deepStrictEqual([before, rFullSearchTriggers().overrideListSet], [false, true]);
		});

		test('modules are set up for R only on Linux, with modules on and an environment that lists R', async () => {
			const onPlatform = (platform: NodeJS.Platform) => testKit.withPlatform(platform, () => rFullSearchTriggers().modulesConfiguredForR);
			const results: Record<string, boolean> = {};
			await modulesConfig().update('environments', { py: { languages: ['python'], modules: ['python/3.12'] } }, vscode.ConfigurationTarget.Global);
			results.noREnvironment = onPlatform('linux');
			await modulesConfig().update('environments', { r: { languages: ['r'], modules: ['R/4.4.1'] } }, vscode.ConfigurationTarget.Global);
			results.rEnvironment = onPlatform('linux');
			results.rEnvironmentOnMac = onPlatform('darwin');
			results.rEnvironmentOnWindows = onPlatform('win32');
			await modulesConfig().update('enabled', false, vscode.ConfigurationTarget.Global);
			results.modulesOff = onPlatform('linux');
			assert.deepStrictEqual(results, {
				noREnvironment: false,
				rEnvironment: true,
				rEnvironmentOnMac: false,
				rEnvironmentOnWindows: false,
				modulesOff: false,
			});
		});
	});
});
