/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as fs from 'fs';
import * as os from 'os';
import { join } from '../../../../base/common/path.js';
import { NullLogger } from '../../../log/common/log.js';
import { IMcpToolCallAuditEvent, McpAuditEvent } from '../../common/positronMcpAudit.js';
import { McpAuditFileWriter } from '../../node/positronMcpAuditFile.js';

function toolCallEvent(overrides: Partial<IMcpToolCallAuditEvent> = {}): McpAuditEvent {
	return {
		type: 'tool-call',
		callId: 'call-1',
		timestamp: 1000,
		sessionId: 'ab12',
		toolName: 'execute-code',
		argsSummary: '{code: "print(1)"}',
		args: { code: 'print(1)', languageId: 'python' },
		outcome: 'ok',
		durationMs: 840,
		pinnedWindowId: 1,
		resultSummary: 'text(2 chars)',
		...overrides,
	};
}

describe('McpAuditFileWriter', () => {
	let dir: string;
	let filePath: string;
	let writer: McpAuditFileWriter;

	beforeEach(() => {
		dir = fs.mkdtempSync(join(os.tmpdir(), 'positron-mcp-audit-'));
		filePath = join(dir, 'positron-mcp-audit.jsonl');
		writer = new McpAuditFileWriter(filePath, new NullLogger());
	});

	afterEach(() => {
		writer.dispose();
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it('creates no file and reports no path until something is persisted', () => {
		expect(writer.path).toBeUndefined();
		expect(fs.existsSync(filePath)).toBe(false);

		// Transient start events are never persisted, so they open no file either.
		writer.write({ type: 'tool-call-start', callId: 'c1', timestamp: 1, sessionId: 's', toolName: 'get-plot', pinnedWindowId: 1 });
		expect(writer.path).toBeUndefined();
		expect(fs.existsSync(filePath)).toBe(false);
	});

	it('writes nothing at off detail', () => {
		writer.detail = 'off';
		writer.write(toolCallEvent());
		expect(writer.path).toBeUndefined();
		expect(fs.existsSync(filePath)).toBe(false);
	});

	it('applies the detail at write time, so a setting change needs no restart', async () => {
		writer.write(toolCallEvent({ callId: 'summary-call' }));
		writer.detail = 'full';
		writer.write(toolCallEvent({ callId: 'full-call' }));
		expect(writer.path).toBe(filePath);

		await vi.waitFor(() => {
			const lines = fs.readFileSync(filePath, 'utf8').trimEnd().split('\n').map(line => JSON.parse(line));
			expect(lines.map(record => [record.callId, record.args])).toEqual([
				['summary-call', undefined],
				['full-call', { code: 'print(1)', languageId: 'python' }],
			]);
		});
	});
});
