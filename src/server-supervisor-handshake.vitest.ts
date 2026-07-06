/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as net from 'node:net';
import { describe, it, expect } from 'vitest';
import { SupervisorHandshakeBroker } from './server-supervisor-handshake.js';

/**
 * A representative connection payload, matching the wire contract kcserver
 * writes over the handshake socket.
 */
const SAMPLE_PAYLOAD = {
	transport: 'tcp',
	port: 49213,
	base_path: 'http://127.0.0.1:49213',
	server_path: '/path/to/kcserver',
	server_pid: 1234,
	bearer_token: 'secret-token',
	log_path: '/path/to/log',
	server_id: 'uuid-v4',
};

/** Simulates kcserver reporting in: connect, write JSON + newline, half-close. */
function reportIn(socketPath: string, payload: object): void {
	const client = net.connect(socketPath, () => {
		client.end(JSON.stringify(payload) + '\n');
	});
}

/** Reads the full payload a broker replays to a connecting client. */
function readReplay(socketPath: string): Promise<object> {
	return new Promise((resolve, reject) => {
		const client = net.connect(socketPath);
		let text = '';
		client.setEncoding('utf8');
		client.on('data', (chunk: string) => { text += chunk; });
		client.on('end', () => {
			try {
				resolve(JSON.parse(text));
			} catch (err) {
				reject(err);
			}
		});
		client.on('error', reject);
	});
}

describe('SupervisorHandshakeBroker', () => {
	it('caches the report-in payload and replays it to later connections', async () => {
		const broker = await SupervisorHandshakeBroker.create(`test-${Math.random().toString(16).slice(2)}`);
		try {
			// kcserver reports in on the first connection.
			reportIn(broker.socketPath, SAMPLE_PAYLOAD);
			await broker.ready(5000);

			// A window's extension host connects later and reads the cached
			// payload back out. Do it twice to confirm the broker keeps serving.
			expect(await readReplay(broker.socketPath)).toEqual(SAMPLE_PAYLOAD);
			expect(await readReplay(broker.socketPath)).toEqual(SAMPLE_PAYLOAD);
		} finally {
			broker.dispose();
		}
	});

	it('ready() rejects when the server never reports in before the timeout', async () => {
		const broker = await SupervisorHandshakeBroker.create(`test-${Math.random().toString(16).slice(2)}`);
		try {
			await expect(broker.ready(100)).rejects.toThrow(/Timed out waiting for the supervisor/);
		} finally {
			broker.dispose();
		}
	});
});
