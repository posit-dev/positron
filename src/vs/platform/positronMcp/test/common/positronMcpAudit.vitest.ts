/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import {
	formatAuditLine,
	IMcpToolCallAuditEvent,
	McpAuditEvent,
	McpAuditRingBuffer,
	summarizeArgs,
	summarizeResult,
	toJsonlRecord,
} from '../../common/positronMcpAudit.js';

function makeToolCallEvent(overrides: Partial<IMcpToolCallAuditEvent> = {}): IMcpToolCallAuditEvent {
	return {
		type: 'tool-call',
		callId: 'call-1',
		timestamp: 1000,
		sessionId: 'ab12',
		clientName: 'claude-code',
		clientVersion: '1.2.3',
		toolName: 'execute-code',
		argsSummary: '{languageId: "python"}',
		outcome: 'ok',
		durationMs: 840,
		pinnedWindowId: 1,
		resultSummary: 'text(532 chars)',
		...overrides,
	};
}

describe('summarizeArgs', () => {
	it('lists every key with safe scalar values', () => {
		expect(summarizeArgs({ languageId: 'python', lines: 12, run: true, extra: null }))
			.toBe('{languageId: "python", lines: 12, run: true, extra: null}');
	});

	it('previews code keys at 200 chars with newlines escaped', () => {
		const code = 'import pandas\n' + 'x'.repeat(300);
		const summary = summarizeArgs({ code });
		expect(summary).toContain('code: "import pandas\\n');
		expect(summary).toContain('..."');
		expect(summary).not.toContain(code);
		// key + quotes + 200-char preview + ellipsis, nothing near the full 300+.
		expect(summary.length).toBeLessThan(220);
	});

	it('truncates non-code strings at 60 chars', () => {
		const path = '/a/'.repeat(50);
		const summary = summarizeArgs({ path });
		expect(summary).toBe(`{path: "${path.slice(0, 60)}..."}`);
	});

	it('renders arrays and objects opaquely', () => {
		expect(summarizeArgs({ cells: [1, 2, 3], options: { deep: true } }))
			.toBe('{cells: [3 items], options: {object}}');
	});

	it('renders empty args as {}', () => {
		expect(summarizeArgs({})).toBe('{}');
	});
});

describe('summarizeResult', () => {
	it('summarizes text and image blocks as types and sizes', () => {
		const base64 = 'A'.repeat(46080);
		const summary = summarizeResult({
			content: [
				{ type: 'text', text: 'hello world' },
				{ type: 'image', data: base64, mimeType: 'image/png' },
			],
		});
		expect(summary).toBe('text(11 chars), image(45KB image/png)');
		expect(summary).not.toContain('hello');
		expect(summary).not.toContain(base64);
	});

	it('reports small images in bytes and empty content explicitly', () => {
		expect(summarizeResult({ content: [{ type: 'image', data: 'abcd', mimeType: 'image/png' }] }))
			.toBe('image(4B image/png)');
		expect(summarizeResult({ content: [] })).toBe('(empty)');
	});
});

describe('formatAuditLine', () => {
	it('formats a completed tool call', () => {
		expect(formatAuditLine(makeToolCallEvent())).toBe(
			'[PositronMcpSession ab12] tools/call execute-code by claude-code 1.2.3 -> ok in 840ms (window 1) | args {languageId: "python"} | result text(532 chars)');
	});

	it('formats an anonymous errored call without client or window', () => {
		expect(formatAuditLine(makeToolCallEvent({
			clientName: undefined,
			clientVersion: undefined,
			pinnedWindowId: undefined,
			outcome: 'error',
			resultSummary: 'text(40 chars)',
		}))).toBe(
			'[PositronMcpSession ab12] tools/call execute-code -> error in 840ms | args {languageId: "python"} | result text(40 chars)');
	});

	it('formats lifecycle and start events', () => {
		const base = { timestamp: 1000, sessionId: 'ab12' } as const;
		expect(formatAuditLine({ ...base, type: 'session-created' }))
			.toBe('[PositronMcpSession ab12] session created');
		expect(formatAuditLine({ ...base, type: 'client-identified', clientName: 'claude-code', clientVersion: '1.2.3', pinnedWindowId: 1 }))
			.toBe('[PositronMcpSession ab12] client identified: claude-code 1.2.3 (window 1)');
		expect(formatAuditLine({ ...base, type: 'window-repinned', pinnedWindowId: undefined }))
			.toBe('[PositronMcpSession ab12] pinned window unavailable; re-pinned to none');
		expect(formatAuditLine({ ...base, type: 'tool-call-start', callId: 'c1', toolName: 'get-plot', clientName: 'claude-code' }))
			.toBe('[PositronMcpSession ab12] tools/call get-plot by claude-code started');
	});
});

describe('toJsonlRecord', () => {
	const code = 'import pandas as pd\n' + 'x = 1\n'.repeat(100);
	const event = makeToolCallEvent({ args: { languageId: 'python', code } });

	it('at summary detail keeps the argument summary but drops the full arguments', () => {
		const record = JSON.parse(toJsonlRecord(event, 'summary')!);
		expect(record.argsSummary).toBe(event.argsSummary);
		expect(record.args).toBeUndefined();
		expect(toJsonlRecord(event, 'summary')).not.toContain('import pandas');
	});

	it('at full detail keeps the complete arguments verbatim', () => {
		const record = JSON.parse(toJsonlRecord(event, 'full')!);
		expect(record.args).toEqual({ languageId: 'python', code });
	});

	it('persists nothing at off detail or for transient start events', () => {
		expect(toJsonlRecord(event, 'off')).toBeUndefined();
		expect(toJsonlRecord(
			{ type: 'tool-call-start', callId: 'c1', timestamp: 1, sessionId: 's', toolName: 'get-plot' },
			'full',
		)).toBeUndefined();
	});

	it('at summary detail drops the context-alert line alongside the arguments', () => {
		const alerted = makeToolCallEvent({ args: { languageId: 'python' }, contextAlert: '[context: 1 new console execution | seq 5]' });
		const record = JSON.parse(toJsonlRecord(alerted, 'summary')!);
		expect(record.contextAlert).toBeUndefined();
		expect(JSON.parse(toJsonlRecord(alerted, 'full')!).contextAlert).toBe('[context: 1 new console execution | seq 5]');
	});

	it('records console-content calls at full detail even at summary (the sensitive-read guarantee)', () => {
		const sensitive = makeToolCallEvent({
			toolName: 'get-user-context',
			args: { include: ['console'], since: 3 },
			returnedConsoleContent: true,
		});
		const record = JSON.parse(toJsonlRecord(sensitive, 'summary')!);
		expect(record.args).toEqual({ include: ['console'], since: 3 });
		expect(record.returnedConsoleContent).toBe(true);
		// 'off' still writes nothing: the user disabled the file entirely.
		expect(toJsonlRecord(sensitive, 'off')).toBeUndefined();
	});

	it('persists lifecycle events as-is at every detail level', () => {
		const lifecycle: McpAuditEvent = { type: 'session-created', timestamp: 2, sessionId: 's' };
		expect(JSON.parse(toJsonlRecord(lifecycle, 'summary')!)).toEqual(lifecycle);
		expect(JSON.parse(toJsonlRecord(lifecycle, 'full')!)).toEqual(lifecycle);
	});
});

describe('McpAuditRingBuffer', () => {
	it('caps at capacity, dropping the oldest', () => {
		const buffer = new McpAuditRingBuffer(3);
		for (let i = 0; i < 5; i++) {
			buffer.push(makeToolCallEvent({ callId: `call-${i}` }));
		}
		expect(buffer.snapshot().map(e => (e as IMcpToolCallAuditEvent).callId))
			.toEqual(['call-2', 'call-3', 'call-4']);
	});

	it('drops tool-call-start events but keeps lifecycle events', () => {
		const buffer = new McpAuditRingBuffer(10);
		buffer.push({ type: 'tool-call-start', callId: 'c1', timestamp: 1, sessionId: 's', toolName: 'get-plot' });
		buffer.push({ type: 'session-created', timestamp: 2, sessionId: 's' });
		expect(buffer.snapshot().map(e => e.type)).toEqual(['session-created']);
	});

	it('snapshot returns a copy', () => {
		const buffer = new McpAuditRingBuffer(10);
		buffer.push(makeToolCallEvent());
		const snapshot = buffer.snapshot();
		(snapshot as McpAuditEvent[]).pop();
		expect(buffer.snapshot()).toHaveLength(1);
	});
});
