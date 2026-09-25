/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { once } from 'events';
import { AddressInfo } from 'net';
import * as positron from 'positron';
import { WebSocketServer } from 'ws';
import { PromiseHandles } from '../async';
import { JupyterCommand } from '../jupyter/JupyterCommand';
import { JupyterRequest } from '../jupyter/JupyterRequest';
import { createSession, markConnected, markExited } from './kallichoreSessionFixture';

/**
 * A kernel exit must reject sends waiting for a connection. Otherwise
 * `startPositronLsp()` can block an R session's services queue and prevent
 * LSP activation for later R sessions.
 *
 * See https://github.com/posit-dev/positron/issues/15781.
 */
suite('Sends after kernel exit', () => {

	/** Fails fast instead of letting a hung send run into the mocha timeout. */
	async function settled<T>(promise: Promise<T>): Promise<T> {
		let timer: NodeJS.Timeout | undefined;
		const timedOut = new Promise<never>((_resolve, reject) => {
			timer = setTimeout(() => reject(new Error('Send did not settle')), 1000);
		});
		try {
			return await Promise.race([promise, timedOut]);
		} finally {
			clearTimeout(timer);
		}
	}

	function newCommand(): JupyterCommand<unknown> {
		// Never reaches a socket; only the connection gating matters.
		return { sendCommand: async () => { } } as unknown as JupyterCommand<unknown>;
	}

	test('rejects the LSP start on an exited kernel', async () => {
		const session = createSession();
		markConnected(session);
		markExited(session);
		try {
			await assert.rejects(
				settled(session.startPositronLsp('positron-lsp-r-test', '127.0.0.1')),
				/the kernel has exited/);
		} finally {
			session.dispose();
		}
	});

	test('rejects a send that was waiting for the connection when the kernel exited', async () => {
		const session = createSession();
		markConnected(session);
		try {

			session.handleMessage({ kind: 'kernel', status: { status: positron.RuntimeState.Offline, reason: 'test' } });
			const sent = session.sendCommand(newCommand());

			markExited(session);

			await assert.rejects(settled(sent), /the kernel has exited/);
		} finally {
			session.dispose();
		}
	});

	test('rejects a waiting send when the barrier closed again before the kernel exited', async () => {
		const session = createSession();
		markConnected(session);
		try {
			const offline = { kind: 'kernel', status: { status: positron.RuntimeState.Offline, reason: 'test' } };
			session.handleMessage(offline);
			const sent = session.sendCommand(newCommand());

			// Replacing the closed barrier here would leave `sent` pending after exit.
			session.handleMessage(offline);
			markExited(session);

			await assert.rejects(settled(sent), /the kernel has exited/);
		} finally {
			session.dispose();
		}
	});

	test('rejects sends once the session is transferred to another client', async () => {
		const session = createSession();
		markConnected(session);
		session.handleMessage({ kind: 'kernel', clientDisconnected: 'another client connected' });
		try {
			await assert.rejects(settled(session.sendCommand(newCommand())), /transferred to another client/);
		} finally {
			session.dispose();
		}
	});

	test('waits for the new connection when an exited kernel is restarted', async () => {
		const session = createSession({ restartSession: async () => ({}) });
		markConnected(session);
		markExited(session);
		try {
			await session.restart();

			// Restart must replace the cancelled barrier before the new kernel
			// connects, so this send waits instead of inheriting the old exit.
			const sent = session.sendCommand(newCommand()).then(() => 'sent', () => 'rejected');
			const waiting = new Promise<string>(resolve => setTimeout(() => resolve('waiting'), 100));
			assert.strictEqual(await Promise.race([sent, waiting]), 'waiting');
		} finally {
			session.dispose();
		}
	});

	test('accepts sends again once an exited session reconnects', async () => {
		// `start()` revives an exited session through `connect()`, without
		// calling `restart()`.
		const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
		await once(server, 'listening');
		const { port } = server.address() as AddressInfo;

		const session = createSession({ basePath: `http://127.0.0.1:${port}` });
		markConnected(session);
		markExited(session);
		try {
			await settled(session.connect());
			await settled(session.sendCommand(newCommand()));
		} finally {
			session.dispose();
			server.close();
		}
	});

	test('rejects a request whose reply was pending when the kernel exited', async () => {
		const session = createSession();
		markConnected(session);
		try {
			const reply = new PromiseHandles<unknown>();
			const request = {
				msgId: 'request-1',
				sendRpc: () => reply.promise,
				reject: (reason: unknown) => reply.reject(reason),
			} as unknown as JupyterRequest<unknown, unknown>;
			const replied = session.sendRequest(request);

			// Let `sendRequest()` register the request before triggering the exit.
			await new Promise(resolve => setImmediate(resolve));
			markExited(session);

			await assert.rejects(settled(replied), /Kernel exited/);
		} finally {
			session.dispose();
		}
	});

	// `deleteSession()` disposes a session whose runtime won't quit, so no exit
	// event may ever arrive to release its consumers.
	test('rejects an LSP start awaiting its port when the session is disposed', async () => {
		const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
		await once(server, 'listening');
		const { port } = server.address() as AddressInfo;

		const session = createSession({ basePath: `http://127.0.0.1:${port}` });
		try {
			await settled(session.connect());
			const starting = session.startPositronLsp('positron-lsp-r-test', '127.0.0.1');

			// Wait until `startPositronLsp()` awaits the kernel's reply, not the
			// connection, so disposal exercises pending-comm cleanup.
			await new Promise(resolve => setImmediate(resolve));
			session.dispose();

			await assert.rejects(settled(starting), /Session disposed/);
		} finally {
			session.dispose();
			server.close();
		}
	});

	test('rejects a send waiting for the connection when the session is disposed', async () => {
		const session = createSession();
		markConnected(session);
		session.handleMessage({ kind: 'kernel', status: { status: positron.RuntimeState.Offline, reason: 'test' } });
		const sent = session.sendCommand(newCommand());

		session.dispose();

		await assert.rejects(settled(sent), /the session was disposed/);
	});
});
