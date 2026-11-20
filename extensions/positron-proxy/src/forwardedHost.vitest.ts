/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as http from 'http';
import { AddressInfo } from 'net';
import express from 'express';
import { legacyCreateProxyMiddleware as createProxyMiddleware } from 'http-proxy-middleware';
import { forwardOriginalHost } from './forwardedHost';

/** Starts a server on a free localhost port and returns its port. */
async function listen(server: http.Server): Promise<number> {
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
	return (server.address() as AddressInfo).port;
}

/** Sends a WebSocket upgrade request and resolves once it is accepted. */
function upgrade(port: number, headers: http.OutgoingHttpHeaders): Promise<void> {
	return new Promise((resolve, reject) => {
		const req = http.request({
			port,
			path: '/websocket/',
			headers: {
				'Connection': 'Upgrade',
				'Upgrade': 'websocket',
				'Sec-WebSocket-Version': '13',
				'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
				...headers,
			},
		});
		req.on('upgrade', (_res, socket) => {
			socket.destroy();
			resolve();
		});
		req.on('response', res => reject(new Error(`Upgrade refused with ${res.statusCode}`)));
		req.on('error', reject);
		req.end();
	});
}

describe('forwardOriginalHost', () => {
	let appPort: number;
	let proxyPort: number;
	let upgradeHeaders: http.IncomingHttpHeaders | undefined;
	const servers: http.Server[] = [];

	beforeAll(async () => {
		// The proxied app records the headers of each upgrade it receives.
		const app = http.createServer();
		app.on('upgrade', (req, socket) => {
			upgradeHeaders = req.headers;
			socket.end('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
		});
		appPort = await listen(app);

		// The proxy, configured as in PositronProxy. The options go in a variable rather than
		// an inline literal: this extension's `paths` mapping resolves 'http-proxy' to its
		// untyped JavaScript, so LegacyOptions lacks http-proxy's own fields such as
		// `target`, which an inline literal's excess-property check would reject.
		const options = {
			target: `http://127.0.0.1:${appPort}`,
			changeOrigin: true,
			ws: true,
			on: { proxyReqWs: forwardOriginalHost },
		};
		const proxy = createProxyMiddleware(options);
		const proxyServer = http.createServer(express().use(proxy));
		proxyServer.on('upgrade', proxy.upgrade);
		proxyPort = await listen(proxyServer);

		servers.push(app, proxyServer);
	});

	afterAll(() => {
		for (const server of servers) {
			server.close();
		}
	});

	beforeEach(() => {
		upgradeHeaders = undefined;
	});

	it('sets X-Forwarded-Host on an upgrade to the host the client used', async () => {
		await upgrade(proxyPort, { Host: 'positron.example.com:8080' });

		expect(upgradeHeaders?.host).toBe(`127.0.0.1:${appPort}`);
		expect(upgradeHeaders?.['x-forwarded-host']).toBe('positron.example.com:8080');
	});

	it('keeps an X-Forwarded-Host set by an outer proxy', async () => {
		await upgrade(proxyPort, { 'Host': '127.0.0.1:8080', 'X-Forwarded-Host': 'positron.example.com' });

		expect(upgradeHeaders?.['x-forwarded-host']).toBe('positron.example.com');
	});
});
