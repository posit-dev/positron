/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { AddressInfo } from 'net';
import WebSocket, { WebSocketServer } from 'ws';
import { McpClient } from '../kcclient/api';
import { McpFrontendChannel } from '../McpFrontendChannel';

/** Stands in for the supervisor's end of the frontend channel. */
class FakeSupervisor {
	readonly server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
	private _frames: { socket: WebSocket; message: { kind: string;[key: string]: unknown } }[] = [];
	private _waiters: (() => void)[] = [];

	constructor() {
		this.server.on('connection', socket => {
			socket.on('message', data => {
				this._frames.push({ socket, message: JSON.parse(data.toString()) });
				this._waiters.splice(0).forEach(wake => wake());
			});
		});
	}

	listening(): Promise<void> {
		return new Promise(resolve => this.server.once('listening', resolve));
	}

	get uri(): string {
		return `ws://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
	}

	/** The next frame of the given kind not already taken, waiting for it. */
	async next(kind: string): Promise<{ socket: WebSocket; message: { kind: string;[key: string]: unknown } }> {
		for (; ;) {
			const index = this._frames.findIndex(frame => frame.message.kind === kind);
			if (index >= 0) {
				return this._frames.splice(index, 1)[0];
			}
			await new Promise<void>(resolve => this._waiters.push(resolve));
		}
	}

	close(): Promise<void> {
		this.server.clients.forEach(client => client.terminate());
		return new Promise(resolve => this.server.close(() => resolve()));
	}
}

const AGENT: McpClient = {
	id: 1,
	name: 'claude-code',
	connected_at: '2026-09-23T00:00:00Z',
};

suite('McpFrontendChannel', () => {
	let supervisor: FakeSupervisor;
	let channel: McpFrontendChannel | undefined;

	setup(async () => {
		supervisor = new FakeSupervisor();
		await supervisor.listening();
	});

	teardown(async () => {
		channel?.dispose();
		await supervisor.close();
	});

	test('announces itself, and again after the supervisor drops the channel', async () => {
		const reported: McpClient[][] = [];
		channel = new McpFrontendChannel(
			supervisor.uri, {}, () => { }, () => ['session-1'], clients => reported.push(clients));

		const first = await supervisor.next('hello');
		first.socket.send(JSON.stringify({ kind: 'clients_changed', clients: [AGENT] }));
		first.socket.close();
		const second = await supervisor.next('hello');

		// The agents can't be vouched for while the channel is down.
		assert.deepStrictEqual(
			{ sessions: second.message.session_ids, reported },
			{ sessions: ['session-1'], reported: [[AGENT], []] });
	});

	test('answers a request for the current plot when there is none', async () => {
		channel = new McpFrontendChannel(supervisor.uri, {}, () => { }, () => []);
		const { socket } = await supervisor.next('hello');

		socket.send(JSON.stringify({
			kind: 'command_request',
			id: 'request-1',
			command_id: 'positron.mcp.getCurrentPlot',
			args: [],
			agent: { name: 'claude-code' },
		}));

		assert.deepStrictEqual(
			(await supervisor.next('command_reply')).message,
			{ kind: 'command_reply', id: 'request-1', ok: true, result: null });
	});
});
