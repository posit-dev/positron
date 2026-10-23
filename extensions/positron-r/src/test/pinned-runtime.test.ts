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

	teardown(async () => {
		await rConfig().update('interpreters.default', undefined, vscode.ConfigurationTarget.Global);
		await rConfig().update('interpreters.exclude', undefined, vscode.ConfigurationTarget.Global);
		await interpretersConfig().update('discovery', undefined, vscode.ConfigurationTarget.Global);
		await interpretersConfig().update('definitions', undefined, vscode.ConfigurationTarget.Global);
	});

	/** Waits for Positron to register a runtime that matches. */
	async function waitForRegisteredRuntime(description: string, matches: (runtime: positron.LanguageRuntimeMetadata) => boolean): Promise<void> {
		const startTime = Date.now();
		while (!(await positron.runtime.getRegisteredRuntimes()).some(matches)) {
			if (Date.now() - startTime > 30_000) {
				throw new Error(`Timed out waiting for Positron to register ${description}`);
			}
			await delay(50);
		}
	}

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

	test('with no pin, the recommendation after discovery returns the current R, to start when R is needed', async function () {
		const current = await currentRInstallation();
		if (!current?.usable) {
			this.skip();
		}
		// The answer comes from the Rs Positron has registered, so wait for discovery to register the current R.
		await waitForRegisteredRuntime('the current R', runtime => runtime.runtimePath === current.binpath);
		const recommended = await runtimeManager.recommendedWorkspaceRuntime(true);

		assert.deepStrictEqual(
			{ path: recommended?.runtimePath, startupBehavior: recommended?.startupBehavior },
			{ path: current.binpath, startupBehavior: positron.LanguageRuntimeStartupBehavior.Implicit },
		);
	});

	test('when discovery is limited to definitions, the recommendation after discovery returns the first defined R', async function () {
		const current = await currentRInstallation();
		if (!current?.usable) {
			this.skip();
		}
		await waitForRegisteredRuntime('the current R', runtime => runtime.runtimePath === current.binpath);
		await interpretersConfig().update('definitions', [
			{ language: 'python', path: '/usr/bin/python3', label: 'Team Python' },
			{ language: 'r', path: current.binpath, label: 'Team R' },
			{ language: 'r', path: current.binpath, label: 'Team R with packages' },
		], vscode.ConfigurationTarget.Global);
		await interpretersConfig().update('discovery', 'definitionsOnly', vscode.ConfigurationTarget.Global);
		// Positron registers an R for each definition once the setting changes.
		await waitForRegisteredRuntime('the defined Rs', runtime => runtime.interpreterDefinition === 'Team R with packages');
		const recommended = await runtimeManager.recommendedWorkspaceRuntime(true);

		assert.deepStrictEqual(
			{ definition: recommended?.interpreterDefinition, startupBehavior: recommended?.startupBehavior },
			{ definition: 'Team R', startupBehavior: positron.LanguageRuntimeStartupBehavior.Implicit },
		);
	});
});
