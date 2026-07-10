/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { HandshakeSocket } from '../HandshakeSocket';
import { KallichoreServerState } from '../ServerState';
import { createUniqueId } from '../util';

/**
 * A representative TCP connection payload, matching the wire contract kcserver
 * writes over the handshake socket.
 */
const SAMPLE_PAYLOAD: KallichoreServerState = {
	transport: 'tcp' as KallichoreServerState['transport'],
	port: 49213,
	base_path: 'http://127.0.0.1:49213',
	server_path: '/path/to/kcserver',
	server_pid: 1234,
	bearer_token: 'secret-token',
	log_path: '/path/to/log',
	server_id: 'uuid-v4',
};

/**
 * Simulates kcserver: connects to the handshake socket, writes the JSON payload
 * (with a trailing newline, as kcserver does), and half-closes the write side
 * so the listener sees EOF.
 */
function reportIn(socketPath: string, payload: KallichoreServerState): void {
	const client = net.connect(socketPath, () => {
		client.end(JSON.stringify(payload) + '\n');
	});
}

suite('HandshakeSocket', () => {
	test('receives and parses the payload written by the server', async () => {
		const handshake = await HandshakeSocket.create(`test-${createUniqueId()}`);
		try {
			reportIn(handshake.socketPath, SAMPLE_PAYLOAD);
			const received = await handshake.payload(5000);
			assert.deepStrictEqual(received, SAMPLE_PAYLOAD);
		} finally {
			handshake.dispose();
		}
	});

	test('rejects when the server never connects before the timeout', async () => {
		const handshake = await HandshakeSocket.create(`test-${createUniqueId()}`);
		try {
			await assert.rejects(
				() => handshake.payload(100),
				/Timed out waiting for the supervisor/);
		} finally {
			handshake.dispose();
		}
	});

	test('rejects when the server sends an invalid payload', async () => {
		const handshake = await HandshakeSocket.create(`test-${createUniqueId()}`);
		try {
			const client = net.connect(handshake.socketPath, () => {
				client.end('this is not json');
			});
			await assert.rejects(
				() => handshake.payload(5000),
				/Failed to parse handshake payload/);
		} finally {
			handshake.dispose();
		}
	});

	test('connect() reads a payload replayed by a broker socket', async () => {
		// Stand in for the web/server broker: a listener that replays the cached
		// payload to a connecting client and closes.
		const brokerPath = os.platform() === 'win32'
			? `\\\\.\\pipe\\kc-test-${createUniqueId()}`
			: path.join(os.tmpdir(), `kc-test-${createUniqueId()}.sock`);
		const broker = net.createServer((socket) => {
			socket.end(JSON.stringify(SAMPLE_PAYLOAD) + '\n');
		});
		await new Promise<void>((resolve) => broker.listen(brokerPath, resolve));
		try {
			const received = await HandshakeSocket.connect(brokerPath, 5000);
			assert.deepStrictEqual(received, SAMPLE_PAYLOAD);
		} finally {
			broker.close();
			if (os.platform() !== 'win32') {
				fs.rmSync(brokerPath, { force: true });
			}
		}
	});
});
