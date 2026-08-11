/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as Sinon from 'sinon';
import * as positron from 'positron';
import './mocha-setup';
import { renvInit } from '../commands';
import * as sessionModule from '../session';

suite('r.renvInit session handling', () => {
	let sandbox: Sinon.SinonSandbox;
	let execute: Sinon.SinonSpy;
	let fakeSession: { execute: Sinon.SinonSpy };

	setup(() => {
		sandbox = Sinon.createSandbox();
		execute = sandbox.spy();
		fakeSession = { execute };
	});

	teardown(() => sandbox.restore());

	test('uses the existing session and starts no runtime', async () => {
		sandbox.stub(positron.runtime, 'getForegroundSession').resolves(fakeSession as any);
		sandbox.stub(sessionModule, 'checkInstalled').resolves(true);
		const select = sandbox.stub(positron.runtime, 'selectLanguageRuntime').resolves();

		await renvInit();

		assert.strictEqual(select.called, false, 'must not restart a live session');
		assert.strictEqual(execute.calledOnce, true);
		assert.ok(execute.firstCall.args[0].includes('renv::init()'));
	});

	test('starts the preferred runtime when no session is running', async () => {
		const foreground = sandbox.stub(positron.runtime, 'getForegroundSession');
		foreground.onFirstCall().resolves(undefined);
		foreground.resolves(fakeSession as any);
		sandbox.stub(positron.runtime, 'getPreferredRuntime')
			.resolves({ runtimeId: 'r-1' } as any);
		const select = sandbox.stub(positron.runtime, 'selectLanguageRuntime').resolves();
		sandbox.stub(sessionModule, 'checkInstalled').resolves(true);

		await renvInit();

		assert.strictEqual(select.calledOnceWith('r-1'), true);
		assert.strictEqual(execute.calledOnce, true);
	});

	test('never calls checkInstalled before a session exists', async () => {
		// checkInstalled throws without a session, which is how the pre-hardening
		// command produced a misleading "Cannot check install status" error.
		const foreground = sandbox.stub(positron.runtime, 'getForegroundSession');
		foreground.onFirstCall().resolves(undefined);
		foreground.resolves(fakeSession as any);
		sandbox.stub(positron.runtime, 'getPreferredRuntime')
			.resolves({ runtimeId: 'r-1' } as any);
		const select = sandbox.stub(positron.runtime, 'selectLanguageRuntime').resolves();
		const checkInstalled = sandbox.stub(sessionModule, 'checkInstalled').resolves(true);

		await renvInit();

		assert.ok(checkInstalled.calledAfter(select), 'checkInstalled must follow session startup');
	});

	test('throws a clear error when there is no R to start', async () => {
		sandbox.stub(positron.runtime, 'getForegroundSession').resolves(undefined);
		sandbox.stub(positron.runtime, 'getPreferredRuntime').resolves(undefined);

		await assert.rejects(renvInit(), /no R installation/i);
	});

	test('throws when the session never becomes available', async () => {
		sandbox.stub(positron.runtime, 'getForegroundSession').resolves(undefined);
		sandbox.stub(positron.runtime, 'getPreferredRuntime')
			.resolves({ runtimeId: 'r-1' } as any);
		sandbox.stub(positron.runtime, 'selectLanguageRuntime').resolves();

		await assert.rejects(renvInit(), /did not start/i);
	});

	test('returns quietly when the user declines to install renv', async () => {
		sandbox.stub(positron.runtime, 'getForegroundSession').resolves(fakeSession as any);
		sandbox.stub(sessionModule, 'checkInstalled').resolves(false);

		await renvInit();

		assert.strictEqual(execute.called, false);
	});
});
