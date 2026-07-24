/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as positron from 'positron';
import { KallichoreSession } from '../KallichoreSession';
import { KallichoreTransport } from '../KallichoreApiInstance';
import { ActiveSession, DefaultApi, InterruptMode, SessionMode, Status } from '../kcclient/api';

/**
 * Regression test for a restart message-ordering race in the session websocket.
 *
 * During a restart the server streams two independent kernel messages over the
 * session websocket: the OLD process's `exited` (code 0), which drives
 * `onExited`, and the NEW process's `status: starting`, which clears the
 * `_restarting` flag in `onStateChange`. The two messages have no ordering
 * guarantee.
 *
 * The bug: `onExited` used to keep the socket open only while `_restarting` was
 * true. When `status: starting` was processed first it cleared `_restarting`,
 * so the subsequent `exited` message fell into the terminal-exit branch and
 * closed the socket mid-restart. That spurious close surfaced as an unexpected
 * `DisconnectReason.Unknown` disconnect and a reconnect that never re-drove the
 * kernel to Ready, leaving the notebook status stuck on "Starting".
 *
 * The fix gates the keep-socket decision on `_exitReason === Restart`, which is
 * set in `restart()` and is not touched by `onStateChange`, so it is
 * order-independent.
 *
 * See https://github.com/posit-dev/positron/issues/10546.
 */
suite('Restart message ordering', () => {

	function createRuntimeMetadata(): positron.LanguageRuntimeMetadata {
		return {
			runtimePath: '/usr/bin/python3',
			runtimeId: '00000000-0000-0000-0000-000000000000',
			runtimeName: 'Python 3.12',
			runtimeShortName: '3.12',
			runtimeVersion: '0.1',
			runtimeSource: 'Test',
			languageName: 'Python',
			languageId: 'python',
			languageVersion: '3.12.0',
			base64EncodedIconSvg: undefined,
			startupBehavior: positron.LanguageRuntimeStartupBehavior.Implicit,
			sessionLocation: positron.LanguageRuntimeSessionLocation.Workspace,
			extraRuntimeData: {},
		};
	}

	function createSessionMetadata(): positron.RuntimeSessionMetadata {
		return {
			sessionId: 'python-test-0001',
			sessionMode: positron.LanguageRuntimeSessionMode.Console,
			notebookUri: undefined,
		};
	}

	/** An `ActiveSession` as returned by the server when reconnecting. */
	function activeSession(): ActiveSession {
		return {
			session_id: 'python-test-0001',
			argv: ['python3', '-m', 'positron_language_server'],
			username: 'test',
			display_name: 'Python 3.12',
			language: 'python',
			interrupt_mode: InterruptMode.Message,
			initial_env: {},
			connected: true,
			started: new Date().toISOString(),
			session_mode: SessionMode.Console,
			working_directory: '/home/test',
			input_prompt: '>>>',
			continuation_prompt: '...',
			execution_queue: { length: 0, pending: [] },
			status: Status.Idle,
			kernel_info: { language_info: { version: '3.12.0' } },
			idle_seconds: 0,
			busy_seconds: 0,
		};
	}

	/**
	 * Builds a session whose `restartSession` call parks until the test releases
	 * it, so the restart's streamed kernel messages can be delivered while the
	 * restart is still in flight -- exactly as the server does.
	 */
	function newRestartingSession(): {
		session: KallichoreSession;
		restartReached: Promise<void>;
		releaseRestart: () => void;
		socketClosed: () => boolean;
	} {
		let signalReached: () => void;
		const restartReached = new Promise<void>(resolve => { signalReached = resolve; });
		let releaseRestart: () => void;
		const restartParked = new Promise<void>(resolve => { releaseRestart = resolve; });

		const api = {
			restartSession: async () => {
				signalReached();
				await restartParked;
				// Return value is ignored by `restart()`; the `unknown` cast on
				// the object below erases the shape mismatch with `DefaultApi`.
				return {};
			},
		} as unknown as DefaultApi;

		const session = new KallichoreSession(
			createSessionMetadata(),
			createRuntimeMetadata(),
			{ sessionName: 'Python 3.12', inputPrompt: '>>>', continuationPrompt: '...' },
			api,
			KallichoreTransport.TCP,
			async () => { /* server is assumed running */ },
			/* isNew */ false,
		);

		// A restored session has the ActiveSession data `buildEnvVarActions`
		// (called inside `restart()`) needs, and leaves the runtime state at
		// Uninitialized so the `status: starting` message is not ignored.
		session.restore(activeSession());

		// Inject a socket double standing in for the live websocket connection.
		// `onExited`'s cleanup branch calls `_socket.close()`; we assert it does
		// not fire mid-restart. There is no non-private seam for the socket, and
		// a live websocket can't run in a unit test.
		let closed = false;
		(session as unknown as { _socket: { close(): void } })._socket = {
			close: () => { closed = true; },
		};

		return { session, restartReached, releaseRestart: () => releaseRestart(), socketClosed: () => closed };
	}

	const startingMessage = { status: { status: positron.RuntimeState.Starting, reason: 'restarting' } };
	const exitedMessage = { exited: 0 };

	test('retains the socket when "starting" is processed before "exited"', async () => {
		// The failing order: the new process's `status: starting` arrives first
		// and clears `_restarting`, then the old process's `exited` arrives.
		const { session, restartReached, releaseRestart, socketClosed } = newRestartingSession();
		try {
			const restart = session.restart();
			await restartReached;

			session.handleKernelMessage(startingMessage);
			session.handleKernelMessage(exitedMessage);

			assert.strictEqual(socketClosed(), false,
				'socket must be retained through a restart even when "starting" precedes "exited"');

			releaseRestart();
			await restart;
		} finally {
			session.dispose();
		}
	});

	test('retains the socket when "exited" is processed before "starting"', async () => {
		// The passing order (control): `exited` arrives before `starting`. This
		// path was already correct; it guards against a regression that would
		// break the good ordering.
		const { session, restartReached, releaseRestart, socketClosed } = newRestartingSession();
		try {
			const restart = session.restart();
			await restartReached;

			session.handleKernelMessage(exitedMessage);
			session.handleKernelMessage(startingMessage);

			assert.strictEqual(socketClosed(), false,
				'socket must be retained through a restart when "exited" precedes "starting"');

			releaseRestart();
			await restart;
		} finally {
			session.dispose();
		}
	});
});
