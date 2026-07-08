/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as fs from 'fs';
import type * as http from 'http';
import * as os from 'os';
import { Event } from '../../../../base/common/event.js';
import { IPCServer } from '../../../../base/parts/ipc/common/ipc.js';
import { join } from '../../../../base/common/path.js';
import { NullLoggerService } from '../../../log/common/log.js';
import { NullTelemetryService } from '../../../telemetry/common/telemetryUtils.js';
import { IMcpToolCallAuditEvent } from '../../common/positronMcpAudit.js';
import { PositronMcpServerRegistry } from '../../node/positronMcpServerRegistry.js';

interface ITestResponse {
	readonly status: number;
	readonly headers: http.IncomingHttpHeaders;
	readonly body: string;
}

async function request(port: number, method: string, path: string, token: string, options: { sessionId?: string; body?: object } = {}): Promise<ITestResponse> {
	const { request: httpRequest } = await import('http');
	return new Promise((resolve, reject) => {
		const headers: http.OutgoingHttpHeaders = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };
		if (options.sessionId) {
			headers['Mcp-Session-Id'] = options.sessionId;
		}
		const req = httpRequest({ host: '127.0.0.1', port, method, path, headers }, res => {
			const chunks: Buffer[] = [];
			res.on('data', chunk => chunks.push(chunk));
			res.on('end', () => resolve({
				status: res.statusCode ?? 0,
				headers: res.headers,
				body: Buffer.concat(chunks).toString('utf8'),
			}));
		});
		req.on('error', reject);
		req.end(options.body ? JSON.stringify(options.body) : undefined);
	});
}

const initializeMessage = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'test-client', version: '1.0.0' } } };

describe('PositronMcpServerRegistry', () => {
	let dir: string;
	let auditPath: string;
	let tokenPath: string;
	let registry: PositronMcpServerRegistry;

	beforeEach(() => {
		dir = fs.mkdtempSync(join(os.tmpdir(), 'positron-mcp-registry-test-'));
		auditPath = join(dir, 'positron-mcp-audit.jsonl');
		tokenPath = join(dir, 'positron-mcp.token');
		// A real IPCServer with a connection source that never fires: no window
		// ever "connects" in these tests, which is fine -- none of them exercise
		// tool-call routing to a live renderer, only registry-level bookkeeping.
		const ipcServer = new IPCServer(Event.None);
		registry = new PositronMcpServerRegistry(ipcServer, auditPath, tokenPath, dir, new NullLoggerService(), NullTelemetryService);
	});

	afterEach(() => {
		registry.dispose();
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it('persists a generated token to disk and reuses it across instances', async () => {
		const status = await registry.getStatus(1);
		expect(status.token).toMatch(/^[0-9a-f]{64}$/);
		expect(fs.readFileSync(tokenPath, 'utf8').trim()).toBe(status.token);

		const ipcServer2 = new IPCServer(Event.None);
		const second = new PositronMcpServerRegistry(ipcServer2, auditPath, tokenPath, dir, new NullLoggerService(), NullTelemetryService);
		try {
			expect((await second.getStatus(1)).token).toBe(status.token);
		} finally {
			second.dispose();
		}
	});

	it('reports not-running status for a window that never started', async () => {
		const status = await registry.getStatus(1);
		expect(status.running).toBe(false);
		expect(status.port).toBe(0);
		expect(status.sessions).toEqual([]);
	});

	it('gives each window its own OS-assigned port', async () => {
		await registry.start(1);
		await registry.start(2);
		const [status1, status2] = await Promise.all([registry.getStatus(1), registry.getStatus(2)]);
		expect(status1.running).toBe(true);
		expect(status2.running).toBe(true);
		expect(status1.port).toBeGreaterThan(0);
		expect(status2.port).toBeGreaterThan(0);
		expect(status1.port).not.toBe(status2.port);
	});

	it('start/stop are idempotent and scoped to their own window', async () => {
		await registry.start(1);
		await registry.start(1); // no-op, already running
		await registry.stop(2); // no-op, never started
		expect((await registry.getStatus(1)).running).toBe(true);
		expect((await registry.getStatus(2)).running).toBe(false);

		await registry.stop(1);
		expect((await registry.getStatus(1)).running).toBe(false);
	});

	it('disposeWindow tears down a window\'s server and frees its port', async () => {
		await registry.start(1);
		expect((await registry.getStatus(1)).running).toBe(true);

		registry.disposeWindow(1);
		expect((await registry.getStatus(1)).running).toBe(false);
	});

	it('aggregates sessions from every window in getAggregateStatus, but getStatus stays scoped to one window', async () => {
		await registry.start(1);
		await registry.start(2);
		const port1 = (await registry.getStatus(1)).port;
		const port2 = (await registry.getStatus(2)).port;
		const token = (await registry.getStatus(1)).token;

		await request(port1, 'POST', '/', token, { body: initializeMessage });
		await request(port2, 'POST', '/', token, { body: initializeMessage });

		expect((await registry.getStatus(1)).sessions).toHaveLength(1);
		expect((await registry.getStatus(2)).sessions).toHaveLength(1);
		const aggregate = await registry.getAggregateStatus(1);
		expect(aggregate.sessions).toHaveLength(2);
		expect(aggregate.sessions.map(s => s.pinnedWindowId).sort()).toEqual([1, 2]);
	});

	it('scopes queryUserContext to the requested window directly, with no session lookup needed', async () => {
		await registry.recordContextEvent(1, { kind: 'console-execution', windowId: 1, timestamp: 1000, languageId: 'python', code: 'in window 1', executedBy: 'user', status: 'ok' });
		await registry.recordContextEvent(2, { kind: 'console-execution', windowId: 2, timestamp: 1000, languageId: 'python', code: 'in window 2', executedBy: 'user', status: 'ok' });

		const scoped = await registry.queryUserContext(1, { mcpSessionId: 'irrelevant-since-windowId-is-explicit' });
		expect(scoped.consoleEvents.map(e => e.code)).toEqual(['in window 1']);

		// The ledger is shared and registry-lifetime: seqs stay consistent
		// regardless of which window asks.
		const unscoped = await registry.queryUserContext(999, { mcpSessionId: 'x' });
		expect(unscoped.seq).toBe(scoped.seq);
	});

	/** Wait for the write stream to flush, then parse the JSONL audit file. */
	async function auditRecords(): Promise<Record<string, unknown>[]> {
		await vi.waitFor(() => expect(fs.existsSync(auditPath)).toBe(true));
		return fs.readFileSync(auditPath, 'utf8').trimEnd().split('\n').map(line => JSON.parse(line));
	}

	it('writes completed tool calls to the JSONL audit file, summary-only by default', async () => {
		await registry.start(1);
		const { port, token } = await registry.getStatus(1);
		const initResponse = await request(port, 'POST', '/', token, { body: initializeMessage });
		const sessionId = initResponse.headers['mcp-session-id'] as string;

		const code = 'import pandas as pd\n' + 'df.head()\n'.repeat(50);
		await request(port, 'POST', '/', token, {
			sessionId,
			body: { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'execute-code', arguments: { code, languageId: 'python' } } },
		});

		await vi.waitFor(async () => {
			const call = (await auditRecords()).find(r => r.type === 'tool-call' && r.sessionId === sessionId);
			expect(call).toBeDefined();
			// At the default 'summary' detail the line has the truncated summary
			// but never the complete arguments.
			expect(call!.argsSummary).toContain('code: "import pandas as pd\\n');
			expect(call!.args).toBeUndefined();
			expect(call!.pinnedWindowId).toBe(1);
		});
		// Once the file exists, the status advertises it for the panel's button.
		expect((await registry.getStatus(1)).auditLogPath).toBe(auditPath);
	});

	it('captures complete arguments in the audit file only at full detail', async () => {
		await registry.setAuditLogDetail(1, 'full');
		await registry.start(1);
		const { port, token } = await registry.getStatus(1);
		const initResponse = await request(port, 'POST', '/', token, { body: initializeMessage });
		const sessionId = initResponse.headers['mcp-session-id'] as string;

		const code = 'x <- rnorm(100)\nplot(x)';
		await request(port, 'POST', '/', token, {
			sessionId,
			body: { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'execute-code', arguments: { code, languageId: 'r' } } },
		});

		await vi.waitFor(async () => {
			const call = (await auditRecords()).find(r => r.type === 'tool-call' && r.sessionId === sessionId);
			expect(call?.args).toEqual({ code, languageId: 'r' });
		});
		// Full arguments stay in the file: the status poll's ring buffer never
		// carries them at any detail level.
		const activity = (await registry.getAggregateStatus(1)).recentActivity
			.filter((e): e is IMcpToolCallAuditEvent => e.type === 'tool-call');
		expect(activity.length).toBeGreaterThan(0);
		expect(activity.every(e => e.args === undefined)).toBe(true);
	});

	it('keeps the context ledger (and its seqs) across a window server stop/start, like window reloads', async () => {
		const before = (await registry.queryUserContext(1, { mcpSessionId: 'x' })).seq;
		await registry.recordContextEvent(1, { kind: 'session-change', windowId: 1, timestamp: Date.now() });
		await registry.start(1);
		await registry.stop(1);
		await registry.start(1);
		// The seq did not reset: `since` values agents hold stay valid for the
		// whole Positron run; they only reset when the app quits.
		expect((await registry.queryUserContext(1, { mcpSessionId: 'x' })).seq).toBe(before + 1);
	});
});
