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

// Pins the machine's current R, so these tests need R installed.
suite('R pinned runtime', () => {
	const rConfig = () => vscode.workspace.getConfiguration('positron.r');

	teardown(async () => {
		await rConfig().update('interpreters.default', undefined, vscode.ConfigurationTarget.Global);
		await rConfig().update('interpreters.exclude', undefined, vscode.ConfigurationTarget.Global);
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
});
