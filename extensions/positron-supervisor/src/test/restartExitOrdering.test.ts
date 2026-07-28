/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as positron from 'positron';
import { KallichoreSession } from '../KallichoreSession';
import { KallichoreTransport } from '../KallichoreApiInstance';
import { DefaultApi } from '../kcclient/api';
import { JupyterCommand } from '../jupyter/JupyterCommand';

/**
 * Regression tests for the restart message ordering race.
 *
 * A restart produces two independent notifications from the Kallichore server:
 * the outgoing kernel's `exited` message, and the replacement kernel's
 * `starting` status. They originate from different server tasks, so their
 * order is not guaranteed. When `starting` arrives first the session must
 * still recognise the exit as part of the restart, and in particular must not
 * tear down the websocket that the replacement kernel is already using.
 *
 * See https://github.com/posit-dev/positron/issues/10016.
 */
suite('Restart exit ordering', () => {

	function createRuntimeMetadata(): positron.LanguageRuntimeMetadata {
		return {
			runtimePath: '/usr/bin/R',
			runtimeId: '00000000-0000-0000-0000-000000000000',
			runtimeName: 'R 4.5.2',
			runtimeShortName: '4.5',
			runtimeVersion: '0.1',
			runtimeSource: 'Test',
			languageName: 'R',
			languageId: 'r',
			languageVersion: '4.5.2',
			base64EncodedIconSvg: undefined,
			startupBehavior: positron.LanguageRuntimeStartupBehavior.Implicit,
			sessionLocation: positron.LanguageRuntimeSessionLocation.Workspace,
			extraRuntimeData: {},
		};
	}

	function createSessionMetadata(): positron.RuntimeSessionMetadata {
		return {
			sessionId: 'r-test-0001',
			sessionMode: positron.LanguageRuntimeSessionMode.Console,
			notebookUri: undefined,
		};
	}

	/**
	 * Creates a session whose restart request stays in flight until the
	 * returned `completeRestart` is called, mirroring the real server, which
	 * only answers the restart request once the replacement kernel is up.
	 */
	function newSession() {
		let completeRestart = () => { };
		const restartAnswered = new Promise<void>(resolve => { completeRestart = resolve; });
		const api = {
			restartSession: async () => {
				await restartAnswered;
				return {};
			},
		} as unknown as DefaultApi;

		const session = new KallichoreSession(
			createSessionMetadata(),
			createRuntimeMetadata(),
			{ sessionName: 'R 4.5.2', inputPrompt: '>', continuationPrompt: '+' },
			api,
			KallichoreTransport.TCP,
			async () => { /* server is assumed running */ },
			/* new */ true,
		);
		return { session, completeRestart };
	}

	/** Drives the session's state machine to an open connection. */
	function markConnected(session: KallichoreSession) {
		session.handleMessage({ kind: 'kernel', status: { status: 'offline', reason: 'test setup' } });
		session.handleMessage({ kind: 'kernel', status: { status: 'idle', reason: 'test setup' } });
	}

	/**
	 * Reports whether the session's connection is still usable. Sends are
	 * gated on the connection barrier, so a send that never settles means the
	 * session considers itself disconnected.
	 */
	async function connectionIsUsable(session: KallichoreSession): Promise<boolean> {
		// The command never reaches a socket; we only care whether the send
		// gets past the connection barrier.
		const command = { sendCommand: async () => { } } as unknown as JupyterCommand<unknown>;
		const sent = session.sendCommand(command).then(() => true, () => true);
		const timedOut = new Promise<boolean>(resolve => setTimeout(() => resolve(false), 100));
		return Promise.race([sent, timedOut]);
	}

	test('keeps the connection when the exit arrives before the replacement kernel starts', async () => {
		const { session, completeRestart } = newSession();
		markConnected(session);
		try {
			const restarting = session.restart();

			// The ordering the supervisor has always assumed.
			session.handleMessage({ kind: 'kernel', status: { status: 'exited', reason: 'child process exited' } });
			session.handleMessage({ kind: 'kernel', exited: 0 });
			session.handleMessage({ kind: 'kernel', status: { status: 'starting', reason: 'start API called' } });

			assert.strictEqual(await connectionIsUsable(session), true,
				'the connection should survive a restart');

			completeRestart();
			await restarting;
		} finally {
			session.dispose();
		}
	});

	test('keeps the connection when the exit arrives after the replacement kernel starts', async () => {
		const { session, completeRestart } = newSession();
		markConnected(session);
		try {
			const restarting = session.restart();

			// The replacement kernel announces itself before the outgoing
			// kernel's exit is delivered.
			session.handleMessage({ kind: 'kernel', status: { status: 'exited', reason: 'child process exited' } });
			session.handleMessage({ kind: 'kernel', status: { status: 'starting', reason: 'start API called' } });
			session.handleMessage({ kind: 'kernel', exited: 0 });

			assert.strictEqual(await connectionIsUsable(session), true,
				'the late exit belongs to the outgoing kernel and must not close ' +
				'the websocket the replacement kernel is using');

			completeRestart();
			await restarting;
		} finally {
			session.dispose();
		}
	});
});
