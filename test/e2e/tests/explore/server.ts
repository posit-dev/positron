/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as http from 'http';
import * as fs from 'fs';
import { Application } from '../../infra/application';
import { executeAction } from './action-executor';
import { ActionRequest } from './types';

const PORT_FILE = '/tmp/explore-runner-port';

function readBody(req: http.IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		let body = '';
		req.on('data', (chunk: string) => body += chunk);
		req.on('end', () => resolve(body));
		req.on('error', reject);
	});
}

/**
 * Start the explore runner HTTP server.
 * Returns a promise that resolves when /done is called.
 */
export function startServer(app: Application): { donePromise: Promise<void>; cleanup: () => void } {
	let resolveDone: () => void;
	const donePromise = new Promise<void>((resolve) => {
		resolveDone = resolve;
	});

	const server = http.createServer(async (req, res) => {
		res.setHeader('Content-Type', 'application/json');

		if (req.method === 'POST' && req.url === '/action') {
			try {
				const body = await readBody(req);
				const request: ActionRequest = JSON.parse(body);
				const result = await executeAction(app, request);
				res.writeHead(200);
				res.end(JSON.stringify(result));
			} catch (err: any) {
				res.writeHead(400);
				res.end(JSON.stringify({ error: err.message }));
			}
			return;
		}

		if (req.method === 'POST' && req.url === '/done') {
			res.writeHead(200);
			res.end(JSON.stringify({ status: 'done' }));
			resolveDone!();
			return;
		}

		if (req.method === 'GET' && req.url === '/health') {
			res.writeHead(200);
			res.end(JSON.stringify({ status: 'ok' }));
			return;
		}

		res.writeHead(404);
		res.end(JSON.stringify({ error: 'Not found. Use POST /action, POST /done, or GET /health' }));
	});

	server.listen(0, () => {
		const addr = server.address();
		const port = typeof addr === 'object' && addr ? addr.port : 0;
		fs.writeFileSync(PORT_FILE, String(port));
		console.log(`Explore runner listening on port ${port}`);
		console.log(`Port written to ${PORT_FILE}`);
	});

	const cleanup = () => {
		server.close();
		try {
			fs.unlinkSync(PORT_FILE);
		} catch {
			// ignore
		}
	};

	return { donePromise, cleanup };
}
