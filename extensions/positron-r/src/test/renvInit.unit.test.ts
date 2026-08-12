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
import { RSession } from '../session';
import { RSessionManager } from '../session-manager';

/** Only runtimeId is read, so the rest of the metadata is not worth building. */
const PREFERRED_RUNTIME = { runtimeId: 'r-1' } as unknown as positron.LanguageRuntimeMetadata;

suite('r.renvInit session handling', () => {
	let sandbox: Sinon.SinonSandbox;
	let execute: Sinon.SinonSpy;
	let fakeSession: RSession;

	/**
	 * Stubs the one session source renvInit and checkInstalled share.
	 * `RSessionManager.getConsoleSession()` returns only R console sessions and
	 * filters out Uninitialized and Exited ones, which is why the foreground
	 * session cannot stand in for it.
	 */
	function stubConsoleSession(): Sinon.SinonStub {
		const getConsoleSession = sandbox.stub();
		sandbox.stub(RSessionManager, 'instance').get(() => ({ getConsoleSession }));
		return getConsoleSession;
	}

	setup(() => {
		sandbox = Sinon.createSandbox();
		execute = sandbox.spy();
		fakeSession = { execute } as unknown as RSession;
	});

	teardown(() => sandbox.restore());

	test('uses the existing console session and starts no runtime', async () => {
		stubConsoleSession().resolves(fakeSession);
		sandbox.stub(sessionModule, 'checkInstalled').resolves(true);
		const select = sandbox.stub(positron.runtime, 'selectLanguageRuntime').resolves();

		await renvInit();

		assert.strictEqual(select.called, false, 'must not restart a live session');
		assert.strictEqual(execute.calledOnce, true);
		assert.ok(execute.firstCall.args[0].includes('renv::init()'));
		// renv::init() prompts, so it has to run visibly and survive an error.
		assert.strictEqual(execute.firstCall.args[2],
			positron.RuntimeCodeExecutionMode.Interactive);
		assert.strictEqual(execute.firstCall.args[3],
			positron.RuntimeErrorBehavior.Continue);
	});

	test('starts the preferred runtime when no session is running', async () => {
		const consoleSession = stubConsoleSession();
		consoleSession.onFirstCall().resolves(undefined);
		consoleSession.resolves(fakeSession);
		sandbox.stub(positron.runtime, 'getPreferredRuntime').resolves(PREFERRED_RUNTIME);
		const select = sandbox.stub(positron.runtime, 'selectLanguageRuntime').resolves();
		sandbox.stub(sessionModule, 'checkInstalled').resolves(true);

		await renvInit();

		assert.strictEqual(select.calledOnceWith('r-1'), true);
		assert.strictEqual(execute.calledOnce, true);
	});

	test('passes the resolved session to checkInstalled', async () => {
		// checkInstalled must not resolve a second, possibly different session.
		stubConsoleSession().resolves(fakeSession);
		const checkInstalled = sandbox.stub(sessionModule, 'checkInstalled').resolves(true);

		await renvInit();

		assert.strictEqual(checkInstalled.firstCall.args[2], fakeSession);
	});

	test('never calls checkInstalled before the poll yields a session', async () => {
		// checkInstalled throws without a session, which is how the pre-hardening
		// command produced a misleading "Cannot check install status" error. It is
		// not enough for the call to follow selectLanguageRuntime: it must follow
		// the poll iteration that actually produced a session.
		const consoleSession = stubConsoleSession();
		consoleSession.onFirstCall().resolves(undefined);
		consoleSession.resolves(fakeSession);
		sandbox.stub(positron.runtime, 'getPreferredRuntime').resolves(PREFERRED_RUNTIME);
		sandbox.stub(positron.runtime, 'selectLanguageRuntime').resolves();

		let sessionLookupsWhenChecked = -1;
		const checkInstalled = sandbox.stub(sessionModule, 'checkInstalled')
			.callsFake(async () => {
				sessionLookupsWhenChecked = consoleSession.callCount;
				return true;
			});

		await renvInit(500, 10);

		assert.strictEqual(checkInstalled.calledOnce, true);
		assert.ok(sessionLookupsWhenChecked >= 2,
			`checkInstalled must run after the poll resolved a session, but ran after ` +
			`${sessionLookupsWhenChecked} session lookup(s)`);
	});

	test('throws a clear error when there is no R to start', async () => {
		stubConsoleSession().resolves(undefined);
		sandbox.stub(positron.runtime, 'getPreferredRuntime').resolves(undefined);

		await assert.rejects(renvInit(), /no R installation/i);
	});

	test('throws when the session never becomes available', async () => {
		stubConsoleSession().resolves(undefined);
		sandbox.stub(positron.runtime, 'getPreferredRuntime').resolves(PREFERRED_RUNTIME);
		sandbox.stub(positron.runtime, 'selectLanguageRuntime').resolves();

		// Short timeout: the production default is 30s and waiting it out here
		// would burn half the mocha budget for no extra coverage.
		await assert.rejects(renvInit(500, 50), /did not start/i);
	});

	test('returns quietly when the user declines to install renv', async () => {
		stubConsoleSession().resolves(fakeSession);
		sandbox.stub(sessionModule, 'checkInstalled').resolves(false);

		await renvInit();

		assert.strictEqual(execute.called, false);
	});
});
