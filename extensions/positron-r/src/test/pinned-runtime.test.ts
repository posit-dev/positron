/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './mocha-setup';

import * as assert from 'assert';
import * as positron from 'positron';
import * as vscode from 'vscode';
import { runtimeManager } from '../extension';
import { currentRInstallation } from '../provider';
import { delay } from '../util';

// Pins the machine's current R, so these tests need R installed.
suite('R pinned runtime', () => {
	const rConfig = () => vscode.workspace.getConfiguration('positron.r');
	const interpretersConfig = () => vscode.workspace.getConfiguration('interpreters');
	const rInterpretersConfig = () => vscode.workspace.getConfiguration('interpreters', { languageId: 'r' });

	teardown(async () => {
		await rConfig().update('interpreters.default', undefined, vscode.ConfigurationTarget.Global);
		await rConfig().update('interpreters.exclude', undefined, vscode.ConfigurationTarget.Global);
		await rInterpretersConfig().update('discovery', undefined, vscode.ConfigurationTarget.Global, true);
		await interpretersConfig().update('definitions', undefined, vscode.ConfigurationTarget.Global);
	});

	test('returns the pinned R to start implicitly, and nothing once that R is excluded', async function () {
		const current = await currentRInstallation();
		if (!current?.usable) {
			this.skip();
		}
		await rConfig().update('interpreters.default', current.binpath, vscode.ConfigurationTarget.Global);
		const pinned = await runtimeManager.pinnedWorkspaceRuntime();
		await rConfig().update('interpreters.exclude', [current.binpath], vscode.ConfigurationTarget.Global);
		const excluded = await runtimeManager.pinnedWorkspaceRuntime();

		assert.deepStrictEqual(
			{ path: pinned?.runtimePath, startupBehavior: pinned?.startupBehavior, excluded },
			{ path: current.binpath, startupBehavior: positron.LanguageRuntimeStartupBehavior.Implicit, excluded: undefined },
		);
	});

	test('returns nothing when no pin is set', async () => {
		assert.strictEqual(await runtimeManager.pinnedWorkspaceRuntime(), undefined);
	});

	// Whether the recommendation starts R right away depends on the open folder, which
	// this suite doesn't set up, so these check what's recommended after discovery.
	test('the recommendation after discovery returns the pinned R, to start when R is needed', async function () {
		const current = await currentRInstallation();
		if (!current?.usable) {
			this.skip();
		}
		await rConfig().update('interpreters.default', current.binpath, vscode.ConfigurationTarget.Global);
		const recommended = await runtimeManager.recommendedWorkspaceRuntime(true);

		assert.deepStrictEqual(
			{ path: recommended?.runtimePath, startupBehavior: recommended?.startupBehavior },
			{ path: current.binpath, startupBehavior: positron.LanguageRuntimeStartupBehavior.Implicit },
		);
	});

	test('under definitionsOnly, the recommendation when a folder opens returns a pin that is one of the definitions', async function () {
		const current = await currentRInstallation();
		if (!current?.usable) {
			this.skip();
		}
		await rConfig().update('interpreters.default', current.binpath, vscode.ConfigurationTarget.Global);
		await rInterpretersConfig().update('discovery', 'definitionsOnly', vscode.ConfigurationTarget.Global, true);
		await interpretersConfig().update('definitions', [{ language: 'r', path: current.binpath }], vscode.ConfigurationTarget.Global);
		const recommended = await runtimeManager.recommendedWorkspaceRuntime();

		// Whether it starts right away depends on the folder, so only the R is checked.
		assert.strictEqual(recommended?.runtimePath, current.binpath);
	});

	test('under definitionsOnly, the recommendation after discovery returns a pin that is one of the definitions, and nothing otherwise', async function () {
		const current = await currentRInstallation();
		if (!current?.usable) {
			this.skip();
		}
		await rConfig().update('interpreters.default', current.binpath, vscode.ConfigurationTarget.Global);
		await rInterpretersConfig().update('discovery', 'definitionsOnly', vscode.ConfigurationTarget.Global, true);
		const notDefined = await runtimeManager.recommendedWorkspaceRuntime(true);
		await interpretersConfig().update('definitions', [{ language: 'r', path: current.binpath }], vscode.ConfigurationTarget.Global);
		const defined = await runtimeManager.recommendedWorkspaceRuntime(true);

		assert.deepStrictEqual(
			{ notDefined, path: defined?.runtimePath, startupBehavior: defined?.startupBehavior },
			{ notDefined: undefined, path: current.binpath, startupBehavior: positron.LanguageRuntimeStartupBehavior.Implicit },
		);
	});

	test('with no pin, the recommendation after discovery returns the current R, to start when R is needed', async function () {
		const current = await currentRInstallation();
		if (!current?.usable) {
			this.skip();
		}
		// The answer comes from the Rs Positron has registered, so wait for discovery to register the current R.
		const startTime = Date.now();
		while (!(await positron.runtime.getRegisteredRuntimes()).some(runtime => runtime.runtimePath === current.binpath)) {
			if (Date.now() - startTime > 30_000) {
				throw new Error('Timed out waiting for discovery to register the current R');
			}
			await delay(50);
		}
		const recommended = await runtimeManager.recommendedWorkspaceRuntime(true);

		assert.deepStrictEqual(
			{ path: recommended?.runtimePath, startupBehavior: recommended?.startupBehavior },
			{ path: current.binpath, startupBehavior: positron.LanguageRuntimeStartupBehavior.Implicit },
		);
	});
});
