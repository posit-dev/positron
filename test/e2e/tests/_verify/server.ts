/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as http from 'http';
import * as fs from 'fs';
import { TestInfo } from '@playwright/test';
import { Application } from '../../infra/application';
import { executeAction, executeBatch, executePom, executeRunPlan, listPoms, listMethodsWithSignatures } from './action-executor';
import { ActionRequest, BatchRequest, PomRequest, RunPlanRequest } from './types';

/** Build a full catalog of all POMs and their methods at startup.
 *  Also enumerates getter-based sub-objects (e.g. dataExplorer.grid, dataExplorer.summaryPanel)
 *  so callers can use dotted paths like "dataExplorer.grid" with POST /pom.
 */
function buildCatalog(app: Application): Record<string, string[]> {
	const workbench = app.workbench as any;
	const catalog: Record<string, string[]> = {};
	for (const name of listPoms(workbench)) {
		const pom = workbench[name];
		catalog[name] = listMethodsWithSignatures(pom);

		// Enumerate getter-based sub-objects (e.g. grid, summaryPanel, filters)
		const proto = Object.getPrototypeOf(pom);
		if (!proto) { continue; }
		for (const key of Object.getOwnPropertyNames(proto)) {
			const descriptor = Object.getOwnPropertyDescriptor(proto, key);
			if (descriptor?.get && !key.startsWith('_')) {
				try {
					const sub = pom[key];
					if (sub && typeof sub === 'object' && Object.getPrototypeOf(sub) !== Object.prototype) {
						const methods = listMethodsWithSignatures(sub);
						if (methods.length > 0) {
							catalog[`${name}.${key}`] = methods;
						}
					}
				} catch { /* skip getters that throw */ }
			}
		}
	}
	return catalog;
}

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
export function startServer(app: Application, testInfo: TestInfo): { donePromise: Promise<void>; cleanup: () => void } {
	const catalog = buildCatalog(app);

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

		if (req.method === 'POST' && req.url === '/pom') {
			try {
				const body = await readBody(req);
				const request: PomRequest = JSON.parse(body);
				const result = await executePom(app, request);
				res.writeHead(200);
				res.end(JSON.stringify(result));
			} catch (err: any) {
				res.writeHead(400);
				res.end(JSON.stringify({ error: err.message }));
			}
			return;
		}

		if (req.method === 'POST' && req.url === '/batch') {
			try {
				const body = await readBody(req);
				const request: BatchRequest = JSON.parse(body);
				const result = await executeBatch(app, request);
				res.writeHead(200);
				res.end(JSON.stringify(result));
			} catch (err: any) {
				res.writeHead(400);
				res.end(JSON.stringify({ error: err.message }));
			}
			return;
		}

		if (req.method === 'POST' && req.url === '/run-plan') {
			try {
				const body = await readBody(req);
				const request: RunPlanRequest = JSON.parse(body);
				const result = await executeRunPlan(app, request);
				res.writeHead(200);
				res.end(JSON.stringify(result));
			} catch (err: any) {
				res.writeHead(400);
				res.end(JSON.stringify({ error: err.message }));
			}
			return;
		}

		if (req.method === 'POST' && req.url === '/describe') {
			try {
				const body = await readBody(req);
				const { description } = JSON.parse(body);
				if (description) {
					testInfo.annotations.push({ type: 'description', description });
				}
				res.writeHead(200);
				res.end(JSON.stringify({ status: 'ok' }));
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
			res.end(JSON.stringify({ status: 'ok', catalog }));
			return;
		}

		if (req.method === 'GET' && req.url?.startsWith('/catalog')) {
			const url = new URL(req.url, `http://localhost`);
			const pomFilter = url.searchParams.get('pom');
			if (pomFilter) {
				const names = pomFilter.split(',').map(s => s.trim());
				const filtered: Record<string, string[]> = {};
				for (const name of names) {
					if (catalog[name]) {
						filtered[name] = catalog[name];
					}
				}
				res.writeHead(200);
				res.end(JSON.stringify(filtered));
			} else {
				res.writeHead(200);
				res.end(JSON.stringify(catalog));
			}
			return;
		}

		res.writeHead(404);
		res.end(JSON.stringify({ error: 'Not found. Use POST /pom, POST /action, POST /batch, POST /run-plan, POST /describe, POST /done, GET /health, or GET /catalog' }));
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
