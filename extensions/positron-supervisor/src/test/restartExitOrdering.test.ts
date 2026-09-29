/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { KallichoreSession } from '../KallichoreSession';
import { JupyterCommand } from '../jupyter/JupyterCommand';
import { createSession, markConnected } from './kallichoreSessionFixture';

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

	/**
	 * Creates a session whose restart request stays in flight until the
	 * returned `completeRestart` is called, mirroring the real server, which
	 * only answers the restart request once the replacement kernel is up.
	 */
	function newSession() {
		let completeRestart = () => { };
		const restartAnswered = new Promise<void>(resolve => { completeRestart = resolve; });
		const session = createSession({
			restartSession: async () => {
				await restartAnswered;
				return {};
			},
		});
		return { session, completeRestart };
	}

	/**
	 * Treat both a pending send and a rejected send as unusable. A pending
	 * send is waiting for a connection; a rejected send hit a cancelled barrier.
	 */
	async function connectionIsUsable(session: KallichoreSession): Promise<boolean> {
		// The command never reaches a socket; we only care whether the send
		// gets past the connection barrier.
		const command = { sendCommand: async () => { } } as unknown as JupyterCommand<unknown>;
		const sent = session.sendCommand(command).then(() => true, () => false);
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
