/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { applyPwbPositAIDefault } from '../pwbDefaults';

function makeContext(): { context: vscode.ExtensionContext; globalState: Map<string, unknown> } {
	const globalState = new Map<string, unknown>();
	const context = {
		globalState: {
			get: <T>(key: string) => globalState.get(key) as T | undefined,
			update: (key: string, value: unknown) => {
				globalState.set(key, value);
				return Promise.resolve();
			},
		},
	} as unknown as vscode.ExtensionContext;
	return { context, globalState };
}

function makeConfigStub(overrides: {
	currentValue?: boolean;
	globalValue?: boolean;
	workspaceValue?: boolean;
	updateError?: Error;
} = {}) {
	return {
		get: sinon.stub().returns(overrides.currentValue),
		inspect: sinon.stub().returns({
			globalValue: overrides.globalValue,
			workspaceValue: overrides.workspaceValue,
			workspaceFolderValue: undefined,
		}),
		update: overrides.updateError
			? sinon.stub().rejects(overrides.updateError)
			: sinon.stub().resolves(),
	};
}

suite('applyPwbPositAIDefault', () => {
	let getConfigurationStub: sinon.SinonStub;

	setup(() => {
		getConfigurationStub = sinon.stub(vscode.workspace, 'getConfiguration');
	});

	teardown(() => {
		sinon.restore();
	});

	test('does nothing when not on PWB', async () => {
		const { context, globalState } = makeContext();
		await applyPwbPositAIDefault(context, false);

		assert.strictEqual(getConfigurationStub.called, false);
		assert.strictEqual(globalState.size, 0);
	});

	test('does nothing when default already applied', async () => {
		const { context, globalState } = makeContext();
		globalState.set('positAI.pwbDefaultApplied', true);

		await applyPwbPositAIDefault(context, true);

		assert.strictEqual(getConfigurationStub.called, false);
	});

	test('disables Posit AI on first run when no explicit value is set', async () => {
		const { context, globalState } = makeContext();
		const config = makeConfigStub({ currentValue: undefined });
		getConfigurationStub.returns(config);

		await applyPwbPositAIDefault(context, true);

		assert.strictEqual(config.update.calledOnceWith('enable', false, vscode.ConfigurationTarget.Global), true);
		assert.strictEqual(globalState.get('positAI.pwbDefaultApplied'), true);
	});

	test('skips update when already disabled', async () => {
		const { context, globalState } = makeContext();
		const config = makeConfigStub({ currentValue: false });
		getConfigurationStub.returns(config);

		await applyPwbPositAIDefault(context, true);

		assert.strictEqual(config.update.called, false);
		assert.strictEqual(globalState.get('positAI.pwbDefaultApplied'), true);
	});

	test('skips update when user has an explicit global value', async () => {
		const { context, globalState } = makeContext();
		const config = makeConfigStub({ currentValue: true, globalValue: true });
		getConfigurationStub.returns(config);

		await applyPwbPositAIDefault(context, true);

		assert.strictEqual(config.update.called, false);
		assert.strictEqual(globalState.get('positAI.pwbDefaultApplied'), true);
	});

	test('skips update when user has an explicit workspace value', async () => {
		const { context, globalState } = makeContext();
		const config = makeConfigStub({ currentValue: true, workspaceValue: true });
		getConfigurationStub.returns(config);

		await applyPwbPositAIDefault(context, true);

		assert.strictEqual(config.update.called, false);
		assert.strictEqual(globalState.get('positAI.pwbDefaultApplied'), true);
	});

	test('marks as applied even when update is blocked by admin policy', async () => {
		const { context, globalState } = makeContext();
		const config = makeConfigStub({ updateError: new Error('policy enforced') });
		getConfigurationStub.returns(config);

		await applyPwbPositAIDefault(context, true);

		assert.strictEqual(config.update.calledOnce, true);
		assert.strictEqual(globalState.get('positAI.pwbDefaultApplied'), true);
	});
});
