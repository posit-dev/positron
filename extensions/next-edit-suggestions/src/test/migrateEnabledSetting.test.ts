/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';

import { migrateEnabledSetting } from '../config.js';

function fakeLog(): vscode.LogOutputChannel {
	return { info: sinon.stub(), warn: sinon.stub() } as unknown as vscode.LogOutputChannel;
}

suite('config / migrateEnabledSetting', () => {
	let update: sinon.SinonStub;
	let inspect: sinon.SinonStub;

	setup(() => {
		update = sinon.stub().resolves();
		inspect = sinon.stub().returns(undefined);
		sinon.stub(vscode.workspace, 'getConfiguration')
			.withArgs('nextEditSuggestions')
			.returns({ inspect, update } as unknown as vscode.WorkspaceConfiguration);
	});

	teardown(() => {
		sinon.restore();
	});

	test('copies a global old value to the new key and clears the old key', async () => {
		const oldVal = { '*': true, markdown: false };
		inspect.withArgs('enable').returns({ globalValue: oldVal });
		inspect.withArgs('enabled').returns({ globalValue: undefined });

		await migrateEnabledSetting(fakeLog());

		assert.ok(update.calledWith('enabled', oldVal, vscode.ConfigurationTarget.Global));
		assert.ok(update.calledWith('enable', undefined, vscode.ConfigurationTarget.Global));
	});

	test('does not overwrite a new value the user already set, but still clears the old key', async () => {
		inspect.withArgs('enable').returns({ globalValue: { '*': true } });
		inspect.withArgs('enabled').returns({ globalValue: { '*': false } });

		await migrateEnabledSetting(fakeLog());

		assert.ok(update.neverCalledWith('enabled', sinon.match.any, vscode.ConfigurationTarget.Global));
		assert.ok(update.calledWith('enable', undefined, vscode.ConfigurationTarget.Global));
	});

	test('migrates global and workspace scopes independently', async () => {
		const globalVal = { '*': true };
		const workspaceVal = { python: false };
		inspect.withArgs('enable').returns({ globalValue: globalVal, workspaceValue: workspaceVal });
		inspect.withArgs('enabled').returns({});

		await migrateEnabledSetting(fakeLog());

		assert.ok(update.calledWith('enabled', globalVal, vscode.ConfigurationTarget.Global));
		assert.ok(update.calledWith('enabled', workspaceVal, vscode.ConfigurationTarget.Workspace));
	});

	test('does nothing when the old key holds no user value', async () => {
		inspect.withArgs('enable').returns({});
		inspect.withArgs('enabled').returns({});

		await migrateEnabledSetting(fakeLog());

		assert.ok(update.notCalled);
	});

	test('logs a warning and does not throw when the write fails', async () => {
		inspect.withArgs('enable').returns({ globalValue: { '*': true } });
		inspect.withArgs('enabled').returns({});
		update.rejects(new Error('read-only settings'));
		const warn = sinon.stub();
		const log = { info: sinon.stub(), warn } as unknown as vscode.LogOutputChannel;

		await migrateEnabledSetting(log);

		assert.ok(warn.called);
	});
});
