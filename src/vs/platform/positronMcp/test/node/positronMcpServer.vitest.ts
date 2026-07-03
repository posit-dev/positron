/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as fs from 'fs';
import type * as http from 'http';
import * as os from 'os';
import { dirname, join } from '../../../../base/common/path.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { NullLoggerService } from '../../../log/common/log.js';
import { NullTelemetryService } from '../../../telemetry/common/telemetryUtils.js';
import { IMcpToolCallAuditEvent } from '../../common/positronMcpAudit.js';
import { IMcpCallToolResult } from '../../common/positronMcpTools.js';
import { isLocalHostHeader, PositronMcpServer } from '../../node/positronMcpServer.js';
import { IPositronMcpToolBroker } from '../../node/positronMcpToolBroker.js';

describe('isLocalHostHeader (DNS-rebinding guard)', () => {
	it('allows local hosts, with or without a port', () => {
		expect(isLocalHostHeader('localhost')).toBe(true);
		expect(isLocalHostHeader('localhost:43123')).toBe(true);
		expect(isLocalHostHeader('127.0.0.1:43123')).toBe(true);
		expect(isLocalHostHeader('LocalHost:43123')).toBe(true);
		expect(isLocalHostHeader('[::1]:43123')).toBe(true);
		expect(isLocalHostHeader('[::1]')).toBe(true);
	});

	it('allows an absent Host header (socket is bound to 127.0.0.1 anyway)', () => {
		expect(isLocalHostHeader(undefined)).toBe(true);
		expect(isLocalHostHeader('')).toBe(true);
	});

	it('rejects non-local hosts (a rebinding page keeps its own domain in Host)', () => {
		expect(isLocalHostHeader('evil.example.com')).toBe(false);
		expect(isLocalHostHeader('evil.example.com:43123')).toBe(false);
		expect(isLocalHostHeader('localhost.evil.example.com')).toBe(false);
		expect(isLocalHostHeader('192.168.1.10:43123')).toBe(false);
	});
});

/** A broker that always has window 1 available and records tool invocations. */
class StubBroker implements IPositronMcpToolBroker {
	readonly invokeTool = vi.fn(async (_windowId: number, name: string): Promise<IMcpCallToolResult> =>
		({ content: [{ type: 'text', text: `called ${name}` }] }));
	resolveTargetWindow(): number | undefined { return 1; }
	isWindowConnected(): boolean { return true; }
}

interface ITestResponse {
	readonly status: number;
	readonly headers: http.IncomingHttpHeaders;
	readonly body: string;
}

/** The token every test request authenticates with (written to the token file before start). */
const TEST_TOKEN = 'test-token-0123456789abcdef-0123456789abcdef';

/** Minimal HTTP client (fetch is happy-dom's here; node's http talks to the real socket). */
async function request(port: number, method: string, path: string, options: { sessionId?: string; body?: object; authorization?: string | null } = {}): Promise<ITestResponse> {
	const { request: httpRequest } = await import('http');
	return new Promise((resolve, reject) => {
		const headers: http.OutgoingHttpHeaders = { 'Content-Type': 'application/json' };
		// Authenticated by default; `null` sends no Authorization header at all.
		if (options.authorization !== null) {
			headers['Authorization'] = options.authorization ?? `Bearer ${TEST_TOKEN}`;
		}
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

const initializeMessage = {
	jsonrpc: '2.0',
	id: 1,
	method: 'initialize',
	params: { clientInfo: { name: 'test-client', version: '1.0.0' } },
};

describe('PositronMcpServer HTTP transport', () => {
	// Random high port so parallel vitest workers (and a live dev server on
	// 43123) never collide. parsePort reads the env at construction time.
	const port = 30000 + Math.floor(Math.random() * 20000);
	let broker: StubBroker;
	let server: PositronMcpServer;
	let auditPath: string;

	beforeAll(async () => {
		process.env.POSITRON_MCP_PORT = String(port);
		const dir = fs.mkdtempSync(join(os.tmpdir(), 'positron-mcp-test-'));
		auditPath = join(dir, 'positron-mcp-audit.jsonl');
		const tokenPath = join(dir, 'positron-mcp.token');
		fs.writeFileSync(tokenPath, TEST_TOKEN + '\n');
		broker = new StubBroker();
		server = new PositronMcpServer(broker, auditPath, tokenPath, new NullLoggerService(), NullTelemetryService);
		await server.start();
	});

	afterAll(async () => {
		delete process.env.POSITRON_MCP_PORT;
		await server.stop();
		server.dispose();
		fs.rmSync(dirname(auditPath), { recursive: true, force: true });
	});

	/** Run the initialize handshake and return the issued session id. */
	async function initialize(): Promise<string> {
		const response = await request(port, 'POST', '/', { body: initializeMessage });
		expect(response.status).toBe(200);
		const sessionId = response.headers['mcp-session-id'];
		expect(typeof sessionId).toBe('string');
		return sessionId as string;
	}

	it('answers the health probe, even unauthenticated (it leaks nothing)', async () => {
		const response = await request(port, 'GET', '/health', { authorization: null });
		expect(response.status).toBe(200);
		expect(JSON.parse(response.body)).toEqual({ status: 'ok', server: 'positron-mcp-server' });
	});

	it('adopts the persisted token and reports it in the status', async () => {
		expect((await server.getStatus()).token).toBe(TEST_TOKEN);
	});

	it('rejects requests without a bearer token with 401', async () => {
		const sessionsBefore = (await server.getStatus()).sessions.length;
		const response = await request(port, 'POST', '/', { body: initializeMessage, authorization: null });
		expect(response.status).toBe(401);
		expect(response.headers['www-authenticate']).toBe('Bearer');
		// No session was created for the rejected initialize.
		expect((await server.getStatus()).sessions.length).toBe(sessionsBefore);
	});

	it('rejects a wrong bearer token with 401, on POST and DELETE alike', async () => {
		const post = await request(port, 'POST', '/', { body: initializeMessage, authorization: 'Bearer wrong-token-0123456789abcdef' });
		expect(post.status).toBe(401);
		const del = await request(port, 'DELETE', '/', { sessionId: generateUuid(), authorization: 'Bearer wrong-token-0123456789abcdef' });
		expect(del.status).toBe(401);
	});

	it('issues a session id on initialize and honors it on later requests', async () => {
		const sessionId = await initialize();
		const response = await request(port, 'POST', '/', { sessionId, body: { jsonrpc: '2.0', id: 2, method: 'tools/list' } });
		expect(response.status).toBe(200);
		expect(JSON.parse(response.body).result.tools.length).toBeGreaterThan(0);
	});

	it('answers GET on the MCP endpoint with 405 and an Allow header, not 404', async () => {
		const response = await request(port, 'GET', '/');
		expect(response.status).toBe(405);
		expect(response.headers.allow).toBe('POST, DELETE, OPTIONS');
	});

	it('answers other unsupported methods with 405', async () => {
		const response = await request(port, 'PUT', '/', { body: initializeMessage });
		expect(response.status).toBe(405);
	});

	it('resumes an unknown but well-formed session id instead of 404ing', async () => {
		// A Positron restart wipes in-memory sessions, so a connected agent's next
		// request carries an id the server has never seen. Claude Code and Codex
		// both break on the strict-spec 404 until a manual reconnect.
		const staleId = generateUuid();
		const response = await request(port, 'POST', '/', { sessionId: staleId, body: { jsonrpc: '2.0', id: 2, method: 'tools/list' } });
		expect(response.status).toBe(200);
		expect(response.headers['mcp-session-id']).toBe(staleId);
		// Not a JSON-RPC "not initialized" error: the resumed session accepts
		// requests immediately, since the client already completed its handshake.
		expect(JSON.parse(response.body).result.tools.length).toBeGreaterThan(0);
		const status = await server.getStatus();
		expect(status.sessions.map(s => s.sessionId)).toContain(staleId);
	});

	it('routes a tool call on a resumed session by lazily re-pinning a window', async () => {
		const staleId = generateUuid();
		const response = await request(port, 'POST', '/', {
			sessionId: staleId,
			body: { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get-session' } },
		});
		expect(response.status).toBe(200);
		// The client stays anonymous until it re-initializes, but its session id
		// still travels with the call.
		expect(broker.invokeTool).toHaveBeenCalledWith(1, 'get-session', {},
			{ mcpSessionId: staleId, clientName: undefined, clientVersion: undefined });
	});

	it('still 404s a malformed session id (an id we could never have issued)', async () => {
		const response = await request(port, 'POST', '/', { sessionId: 'not-a-uuid', body: { jsonrpc: '2.0', id: 2, method: 'tools/list' } });
		expect(response.status).toBe(404);
	});

	it('rejects a session-less non-initialize POST with 400', async () => {
		const response = await request(port, 'POST', '/', { body: { jsonrpc: '2.0', id: 2, method: 'tools/list' } });
		expect(response.status).toBe(400);
	});

	it('tears down a session on DELETE', async () => {
		const sessionId = await initialize();
		const response = await request(port, 'DELETE', '/', { sessionId });
		expect(response.status).toBe(200);
		const status = await server.getStatus();
		expect(status.sessions.map(s => s.sessionId)).not.toContain(sessionId);
	});

	it('treats DELETE of an unknown session as success (idempotent teardown)', async () => {
		const response = await request(port, 'DELETE', '/', { sessionId: generateUuid() });
		expect(response.status).toBe(200);
	});

	it('rejects DELETE without a session id', async () => {
		const response = await request(port, 'DELETE', '/');
		expect(response.status).toBe(400);
	});

	/** Wait for the write stream to flush, then parse the JSONL audit file. */
	async function auditRecords(): Promise<Record<string, unknown>[]> {
		await vi.waitFor(() => expect(fs.existsSync(auditPath)).toBe(true));
		return fs.readFileSync(auditPath, 'utf8').trimEnd().split('\n').map(line => JSON.parse(line));
	}

	it('writes completed tool calls to the JSONL audit file, summary-only by default', async () => {
		const sessionId = await initialize();
		const code = 'import pandas as pd\n' + 'df.head()\n'.repeat(50);
		await request(port, 'POST', '/', {
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
		});
		// Once the file exists, the status advertises it for the panel's button.
		expect((await server.getStatus()).auditLogPath).toBe(auditPath);
	});

	it('captures complete arguments in the audit file only at full detail', async () => {
		await server.setAuditLogDetail('full');
		try {
			const sessionId = await initialize();
			const code = 'x <- rnorm(100)\nplot(x)';
			await request(port, 'POST', '/', {
				sessionId,
				body: { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'execute-code', arguments: { code, languageId: 'r' } } },
			});

			await vi.waitFor(async () => {
				const call = (await auditRecords()).find(r => r.type === 'tool-call' && r.sessionId === sessionId);
				expect(call?.args).toEqual({ code, languageId: 'r' });
			});
			// Full arguments stay in the file: the status poll's ring buffer never
			// carries them at any detail level.
			const activity = (await server.getStatus()).recentActivity
				.filter((e): e is IMcpToolCallAuditEvent => e.type === 'tool-call');
			expect(activity.length).toBeGreaterThan(0);
			expect(activity.every(e => e.args === undefined)).toBe(true);
		} finally {
			await server.setAuditLogDetail('summary');
		}
	});
});
