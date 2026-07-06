/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import {
	buildUserContextResult,
	DEFAULT_MAX_CONSOLE_ENTRIES,
	IMcpConsoleExecutionEvent,
	IMcpUserContextStateSnapshot,
	IMcpWorkbenchChangeEvent,
	MAX_CONTEXT_FIELD_LENGTH,
	McpContextLedger,
	parseUserContextArgs,
} from '../../common/positronMcpContext.js';

function exec(overrides: Partial<IMcpConsoleExecutionEvent> = {}): IMcpConsoleExecutionEvent {
	return {
		kind: 'console-execution',
		windowId: 1,
		timestamp: 1000,
		languageId: 'python',
		code: 'x = 1',
		executedBy: 'user',
		status: 'ok',
		...overrides,
	};
}

function change(kind: IMcpWorkbenchChangeEvent['kind'], overrides: Partial<IMcpWorkbenchChangeEvent> = {}): IMcpWorkbenchChangeEvent {
	return { kind, windowId: 1, timestamp: 1000, ...overrides };
}

describe('McpContextLedger', () => {
	describe('seq assignment', () => {
		it('assigns monotonically increasing seqs and tracks the high water mark', () => {
			const ledger = new McpContextLedger();
			expect(ledger.highWaterSeq).toBe(0);
			expect(ledger.record(exec())).toBe(1);
			expect(ledger.record(change('editor-change', { change: 'editor' }))).toBe(2);
			expect(ledger.record(exec())).toBe(3);
			expect(ledger.highWaterSeq).toBe(3);
		});
	});

	describe('consumeAlert', () => {
		it('returns undefined when nothing happened since the cursor', () => {
			const ledger = new McpContextLedger();
			ledger.ensureCursor('s1');
			expect(ledger.consumeAlert('s1', 1)).toBeUndefined();
		});

		it('summarizes user activity with counts, flags errors distinctly, and reports the high-water seq', () => {
			const ledger = new McpContextLedger();
			ledger.ensureCursor('s1');
			ledger.record(exec());
			ledger.record(exec({ status: 'error', error: { name: 'ValueError', message: 'bad', traceback: [] } }));
			ledger.record(change('editor-change', { change: 'editor' }));
			ledger.record(change('notebook-open'));
			ledger.record(change('session-change'));
			expect(ledger.consumeAlert('s1', 1)).toBe(
				'[context: 2 new console executions (1 error) | active editor changed | 1 notebook opened | active session changed | seq 5]');
		});

		it('consumes: a second call with no new events returns undefined', () => {
			const ledger = new McpContextLedger();
			ledger.ensureCursor('s1');
			ledger.record(exec());
			expect(ledger.consumeAlert('s1', 1)).toContain('1 new console execution');
			expect(ledger.consumeAlert('s1', 1)).toBeUndefined();
		});

		it('never reports events caused by the requesting client (self-echo filter)', () => {
			const ledger = new McpContextLedger();
			ledger.ensureCursor('s1');
			ledger.record(exec({ causedByMcpSession: 's1', executedBy: 'Claude Code' }));
			ledger.record(change('editor-change', { change: 'editor', causedByMcpSession: 's1' }));
			expect(ledger.consumeAlert('s1', 1)).toBeUndefined();
		});

		it('never reports another MCP client\'s events either (alerts are user activity only)', () => {
			const ledger = new McpContextLedger();
			ledger.ensureCursor('s1');
			ledger.record(exec({ causedByMcpSession: 's2', executedBy: 'Codex' }));
			expect(ledger.consumeAlert('s1', 1)).toBeUndefined();
		});

		it('scopes to the pinned window', () => {
			const ledger = new McpContextLedger();
			ledger.ensureCursor('s1');
			ledger.record(exec({ windowId: 2 }));
			expect(ledger.consumeAlert('s1', 1)).toBeUndefined();
		});

		it('says "selection changed" when only the selection moved, "active editor changed" when the editor did', () => {
			const ledger = new McpContextLedger();
			ledger.ensureCursor('s1');
			ledger.record(change('editor-change', { change: 'selection' }));
			expect(ledger.consumeAlert('s1', 1)).toBe('[context: selection changed | seq 1]');
			ledger.record(change('editor-change', { change: 'selection' }));
			ledger.record(change('editor-change', { change: 'editor' }));
			expect(ledger.consumeAlert('s1', 1)).toBe('[context: active editor changed | seq 3]');
		});

		it('starts the cursor at connect time: events before ensureCursor are never alerted', () => {
			const ledger = new McpContextLedger();
			ledger.record(exec());
			ledger.ensureCursor('s1');
			expect(ledger.consumeAlert('s1', 1)).toBeUndefined();
		});

		it('ensureCursor is a no-op for a resumed session, keeping its place', () => {
			const ledger = new McpContextLedger();
			ledger.ensureCursor('s1');
			ledger.record(exec());
			ledger.ensureCursor('s1');
			expect(ledger.consumeAlert('s1', 1)).toContain('1 new console execution');
		});

		it('advanceCursor skips pending events without emitting an alert', () => {
			const ledger = new McpContextLedger();
			ledger.ensureCursor('s1');
			ledger.record(exec());
			ledger.advanceCursor('s1');
			expect(ledger.consumeAlert('s1', 1)).toBeUndefined();
		});
	});

	describe('query', () => {
		it('filters event-like data by since but reports state changes from the same events', () => {
			const ledger = new McpContextLedger();
			ledger.record(exec({ code: 'a' }));
			ledger.record(change('editor-change', { change: 'editor' }));
			ledger.record(exec({ code: 'b' }));

			const data = ledger.query({ mcpSessionId: 's1', since: 2 }, 1);
			expect(data.consoleEvents.map(e => e.code)).toEqual(['b']);
			expect(data.changed).toEqual({ session: false, editor: false, notebooks: false });

			const all = ledger.query({ mcpSessionId: 's1' }, 1);
			expect(all.consoleEvents.map(e => e.code)).toEqual(['a', 'b']);
			// No since: state sections always count as changed.
			expect(all.changed).toEqual({ session: true, editor: true, notebooks: true });
		});

		it('reports state-like changes after since per category', () => {
			const ledger = new McpContextLedger();
			ledger.record(change('session-change'));
			const since = ledger.highWaterSeq;
			ledger.record(change('notebook-open'));
			const data = ledger.query({ mcpSessionId: 's1', since }, 1);
			expect(data.changed).toEqual({ session: false, editor: false, notebooks: true });
		});

		it('enforces the attribution boundary: own and user events visible, other clients\' hidden', () => {
			const ledger = new McpContextLedger();
			ledger.record(exec({ code: 'user code' }));
			ledger.record(exec({ code: 'own code', causedByMcpSession: 's1', executedBy: 'Claude Code' }));
			ledger.record(exec({ code: 'other client code', causedByMcpSession: 's2', executedBy: 'Codex' }));
			const data = ledger.query({ mcpSessionId: 's1' }, 1);
			expect(data.consoleEvents.map(e => e.code)).toEqual(['user code', 'own code']);
		});

		it('caps console entries to the most recent, keeping errors visible in their own list', () => {
			const ledger = new McpContextLedger();
			ledger.record(exec({ code: 'boom', status: 'error', error: { name: 'ValueError', message: 'bad', traceback: ['line 1'] } }));
			for (let i = 0; i < 5; i++) {
				ledger.record(exec({ code: `ok ${i}` }));
			}
			const data = ledger.query({ mcpSessionId: 's1', maxConsoleEntries: 3 }, 1);
			expect(data.consoleEvents.map(e => e.code)).toEqual(['ok 2', 'ok 3', 'ok 4']);
			expect(data.errorEvents.map(e => e.code)).toEqual(['boom']);
		});

		it('flags a since ahead of the current seq (stale value from a previous run) and returns everything', () => {
			const ledger = new McpContextLedger();
			ledger.record(exec());
			const data = ledger.query({ mcpSessionId: 's1', since: 999 }, 1);
			expect(data.sinceAheadOfSeq).toBe(true);
			expect(data.consoleEvents).toHaveLength(1);
			expect(data.changed).toEqual({ session: true, editor: true, notebooks: true });
		});

		it('flags eviction when since predates the retained window', () => {
			const ledger = new McpContextLedger(2);
			ledger.record(exec({ code: 'a' }));
			ledger.record(exec({ code: 'b' }));
			ledger.record(exec({ code: 'c' }));
			const data = ledger.query({ mcpSessionId: 's1', since: 0 }, 1);
			expect(data.eventsEvicted).toBe(true);
			expect(data.consoleEvents.map(e => e.code)).toEqual(['b', 'c']);
			expect(ledger.query({ mcpSessionId: 's1', since: 1 }, 1).eventsEvicted).toBe(false);
		});

		it('scopes events and change detection to the pinned window when one is given', () => {
			const ledger = new McpContextLedger();
			ledger.record(exec({ windowId: 2, code: 'other window' }));
			ledger.record(change('notebook-open', { windowId: 2 }));
			const scoped = ledger.query({ mcpSessionId: 's1', since: 0 }, 1);
			expect(scoped.consoleEvents).toEqual([]);
			expect(scoped.changed.notebooks).toBe(false);
			const unscoped = ledger.query({ mcpSessionId: 's1', since: 0 }, undefined);
			expect(unscoped.consoleEvents).toHaveLength(1);
			expect(unscoped.changed.notebooks).toBe(true);
		});
	});

	describe('payload truncation at record time', () => {
		it('caps code and output with markers, directing to inspect-variable for output', () => {
			const ledger = new McpContextLedger();
			ledger.record(exec({ code: 'x'.repeat(MAX_CONTEXT_FIELD_LENGTH + 100), output: 'y'.repeat(MAX_CONTEXT_FIELD_LENGTH + 100) }));
			const [event] = ledger.query({ mcpSessionId: 's1' }, 1).consoleEvents;
			expect(event.code.length).toBeLessThan(MAX_CONTEXT_FIELD_LENGTH + 50);
			expect(event.code.endsWith('[code truncated]')).toBe(true);
			expect(event.output).toContain('[output truncated - use inspect-variable to read large values]');
		});

		it('keeps whole traceback lines up to the budget and marks the cut', () => {
			const ledger = new McpContextLedger();
			const traceback = Array.from({ length: 50 }, (_, i) => `frame ${i}: ${'z'.repeat(100)}`);
			ledger.record(exec({ status: 'error', error: { name: 'ValueError', message: 'bad', traceback } }));
			const [event] = ledger.query({ mcpSessionId: 's1' }, 1).errorEvents;
			const lines = event.error!.traceback;
			expect(lines[lines.length - 1]).toBe('[traceback truncated]');
			expect(lines.length).toBeLessThan(traceback.length);
			expect(lines.slice(0, -1).join('').length).toBeLessThanOrEqual(MAX_CONTEXT_FIELD_LENGTH);
		});
	});

	describe('selection coalescing', () => {
		it('replaces a run of selection-only moves with the latest one', () => {
			const ledger = new McpContextLedger();
			ledger.record(exec());
			ledger.record(change('editor-change', { change: 'selection' }));
			ledger.record(change('editor-change', { change: 'selection' }));
			ledger.record(change('editor-change', { change: 'selection' }));
			// Three selection moves consumed three seqs but occupy one slot.
			expect(ledger.highWaterSeq).toBe(4);
			const data = ledger.query({ mcpSessionId: 's1', since: 0 }, 1);
			expect(data.consoleEvents).toHaveLength(1);
			expect(data.changed.editor).toBe(true);
			// The coalesced marker carries the newest seq, so change detection
			// against a cursor between the moves still fires.
			expect(ledger.query({ mcpSessionId: 's1', since: 3 }, 1).changed.editor).toBe(true);
		});

		it('does not coalesce across editor switches or different causers', () => {
			const ledger = new McpContextLedger();
			ledger.record(change('editor-change', { change: 'selection' }));
			ledger.record(change('editor-change', { change: 'editor' }));
			ledger.record(change('editor-change', { change: 'selection' }));
			ledger.record(change('editor-change', { change: 'selection', causedByMcpSession: 's1' }));
			expect(ledger.highWaterSeq).toBe(4);
			// All four survive: no two adjacent events were coalescable.
			const data = ledger.query({ mcpSessionId: 's1', since: 0 }, 1);
			expect(data.changed.editor).toBe(true);
		});
	});
});

describe('parseUserContextArgs', () => {
	it('defaults to all sections, no since, and the default entry cap', () => {
		const parsed = parseUserContextArgs({});
		expect([...parsed.include].sort()).toEqual(['console', 'editor', 'errors', 'notebooks', 'session']);
		expect(parsed.since).toBeUndefined();
		expect(parsed.maxConsoleEntries).toBe(DEFAULT_MAX_CONSOLE_ENTRIES);
	});

	it('accepts a section subset and clamps maxConsoleEntries to the ceiling', () => {
		const parsed = parseUserContextArgs({ include: ['errors', 'console'], since: 42, maxConsoleEntries: 10_000 });
		expect([...parsed.include].sort()).toEqual(['console', 'errors']);
		expect(parsed.since).toBe(42);
		expect(parsed.maxConsoleEntries).toBe(50);
	});

	it('rejects unknown sections, non-integer since, and non-positive maxConsoleEntries', () => {
		expect(() => parseUserContextArgs({ include: ['sessions'] })).toThrow(/Unknown include section/);
		expect(() => parseUserContextArgs({ include: 'errors' })).toThrow(/must be an array/);
		expect(() => parseUserContextArgs({ since: -1 })).toThrow(/non-negative integer/);
		expect(() => parseUserContextArgs({ since: 1.5 })).toThrow(/non-negative integer/);
		expect(() => parseUserContextArgs({ maxConsoleEntries: 0 })).toThrow(/positive integer/);
	});
});

describe('buildUserContextResult', () => {
	const snapshot: IMcpUserContextStateSnapshot = {
		session: { name: 'Python 3.12', languageId: 'python', languageVersion: '3.12.1', mode: 'console', sessionId: 'py-1' },
		editor: { path: '/work/analysis.py', kind: 'text', languageId: 'python', cursor: { line: 4, character: 0 }, selection: null },
		notebooks: [{ path: '/work/nb.ipynb', isActive: true }],
	};

	function data(overrides: Partial<ReturnType<McpContextLedger['query']>> = {}) {
		return {
			seq: 7,
			sinceAheadOfSeq: false,
			eventsEvicted: false,
			consoleEvents: [],
			errorEvents: [],
			changed: { session: true, editor: true, notebooks: true },
			...overrides,
		};
	}

	function parse(result: ReturnType<typeof buildUserContextResult>): Record<string, unknown> {
		expect(result.content[0].type).toBe('text');
		return JSON.parse((result.content[0] as { text: string }).text);
	}

	it('returns a stable shape: seq always present, all sections included by default', () => {
		const result = buildUserContextResult(parseUserContextArgs({}), data(), snapshot);
		expect(parse(result)).toEqual({
			seq: 7,
			session: snapshot.session,
			editor: snapshot.editor,
			console: [],
			notebooks: snapshot.notebooks,
			errors: [],
		});
	});

	it('honors the include filter', () => {
		const result = buildUserContextResult(parseUserContextArgs({ include: ['errors'] }), data(), snapshot);
		expect(parse(result)).toEqual({ seq: 7, errors: [] });
	});

	it('omits unchanged state sections when since was given, keeping event sections', () => {
		const args = parseUserContextArgs({ since: 5 });
		const result = buildUserContextResult(args, data({ changed: { session: false, editor: true, notebooks: false } }), snapshot);
		expect(parse(result)).toEqual({ seq: 7, editor: snapshot.editor, console: [], errors: [] });
	});

	it('includes everything and a note when since is ahead of the current seq', () => {
		const args = parseUserContextArgs({ since: 99 });
		const result = buildUserContextResult(args, data({ sinceAheadOfSeq: true, changed: { session: false, editor: false, notebooks: false } }), snapshot);
		const response = parse(result);
		expect(response.note).toContain('reset when Positron restarts');
		expect(response.session).toEqual(snapshot.session);
		expect(response.notebooks).toEqual(snapshot.notebooks);
	});

	it('notes eviction when events after since were dropped', () => {
		const result = buildUserContextResult(parseUserContextArgs({ since: 1 }), data({ eventsEvicted: true }), snapshot);
		expect(parse(result).note).toContain('dropped');
	});

	it('maps console entries (error name/message only) and error entries (full traceback)', () => {
		const errorEvent = {
			...exec({
				timestamp: 1700000000000,
				code: '1/0',
				executedBy: 'user',
				status: 'error' as const,
				output: 'partial',
				error: { name: 'ZeroDivisionError', message: 'division by zero', traceback: ['File "x.py", line 1'] },
			}),
			seq: 6,
		};
		const result = buildUserContextResult(parseUserContextArgs({}), data({ consoleEvents: [errorEvent], errorEvents: [errorEvent] }), snapshot);
		const response = parse(result);
		expect(response.console).toEqual([{
			seq: 6,
			time: new Date(1700000000000).toISOString(),
			by: 'user',
			languageId: 'python',
			code: '1/0',
			status: 'error',
			output: 'partial',
			error: { name: 'ZeroDivisionError', message: 'division by zero' },
		}]);
		expect(response.errors).toEqual([{
			seq: 6,
			time: new Date(1700000000000).toISOString(),
			by: 'user',
			languageId: 'python',
			code: '1/0',
			error: { name: 'ZeroDivisionError', message: 'division by zero', traceback: ['File "x.py", line 1'] },
		}]);
	});

	it('sets the audit hint only when console content is actually returned', () => {
		const empty = buildUserContextResult(parseUserContextArgs({}), data(), snapshot);
		expect(empty.auditHint?.returnedConsoleContent).toBeUndefined();
		expect(empty.auditHint?.advanceContextCursor).toBe(true);

		const withEvents = buildUserContextResult(parseUserContextArgs({}), data({ consoleEvents: [{ ...exec(), seq: 3 }] }), snapshot);
		expect(withEvents.auditHint?.returnedConsoleContent).toBe(true);

		const stateOnly = buildUserContextResult(parseUserContextArgs({ include: ['session'] }), data(), snapshot);
		expect(stateOnly.auditHint?.returnedConsoleContent).toBeUndefined();
		// No event sections served: the alert cursor must not be advanced.
		expect(stateOnly.auditHint?.advanceContextCursor).toBeUndefined();
	});
});
