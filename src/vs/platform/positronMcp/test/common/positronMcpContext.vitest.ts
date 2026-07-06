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
	MCP_USER_CONTEXT_SECTIONS,
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

		it('summarizes user activity with counts, flags errors distinctly, and reports the pre-alert cursor as seq', () => {
			const ledger = new McpContextLedger();
			ledger.record(exec({ code: 'already seen' }));
			ledger.ensureCursor('s1');
			ledger.record(exec());
			ledger.record(exec({ status: 'error', error: { name: 'ValueError', message: 'bad', traceback: [] } }));
			ledger.record(change('editor-change', { change: 'editor' }));
			ledger.record(change('notebook-open'));
			ledger.record(change('session-change'));
			expect(ledger.consumeAlert('s1', 1)).toBe(
				'[context: 2 new console executions (1 error) | active editor changed | 1 notebook opened | active session changed | seq 1]');
		});

		it('the alerted seq round-trips as since: the follow-up query returns exactly the alerted events', () => {
			const ledger = new McpContextLedger();
			ledger.record(exec({ code: 'before connect' }));
			ledger.ensureCursor('s1');
			ledger.record(exec({ code: 'alerted ok' }));
			ledger.record(exec({ code: 'alerted boom', status: 'error', error: { name: 'ValueError', message: 'bad', traceback: [] } }));

			const alert = ledger.consumeAlert('s1', 1);
			const seq = Number(/seq (\d+)\]$/.exec(alert!)![1]);
			const data = ledger.query({ mcpSessionId: 's1', since: seq }, 1);
			expect(data.consoleEvents.map(e => e.code)).toEqual(['alerted ok', 'alerted boom']);
			expect(data.errorEvents.map(e => e.code)).toEqual(['alerted boom']);
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
			expect(ledger.consumeAlert('s1', 1)).toBe('[context: selection changed | seq 0]');
			ledger.record(change('editor-change', { change: 'selection' }));
			ledger.record(change('editor-change', { change: 'editor' }));
			expect(ledger.consumeAlert('s1', 1)).toBe('[context: active editor changed | seq 1]');
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

		it('advanceCursorForReport skips events through the given seq without emitting an alert', () => {
			const ledger = new McpContextLedger();
			ledger.ensureCursor('s1');
			ledger.record(exec());
			ledger.advanceCursorForReport('s1', ledger.highWaterSeq, undefined);
			expect(ledger.consumeAlert('s1', 1)).toBeUndefined();
		});

		it('advanceCursorForReport keeps events past the given seq pending, and never moves backward', () => {
			const ledger = new McpContextLedger();
			ledger.ensureCursor('s1');
			ledger.record(exec({ code: 'reported' }));
			const reportedThrough = ledger.highWaterSeq;
			ledger.record(exec({ code: 'after the report' }));
			ledger.advanceCursorForReport('s1', reportedThrough, undefined);
			// The event recorded after the reported seq still alerts...
			expect(ledger.consumeAlert('s1', 1)).toBe('[context: 1 new console execution | seq 1]');
			// ...and a stale advance cannot rewind the cursor to re-alert it.
			ledger.advanceCursorForReport('s1', reportedThrough, undefined);
			expect(ledger.consumeAlert('s1', 1)).toBeUndefined();
		});

		it('advanceCursorForReport is ignored when the reported since skipped owed events', () => {
			const ledger = new McpContextLedger();
			ledger.ensureCursor('s1'); // cursor 0
			ledger.record(exec({ code: 'owed but never reported' }));
			ledger.record(exec({ code: 'reported' }));
			// The report only covered events after since=1, so the seq-1 event
			// is still owed: the cursor must not move.
			ledger.advanceCursorForReport('s1', ledger.highWaterSeq, 1);
			expect(ledger.consumeAlert('s1', 1)).toBe('[context: 2 new console executions | seq 0]');
		});

		it('flags dropped events when the buffer evicted activity the cursor still owed', () => {
			const ledger = new McpContextLedger(2);
			ledger.ensureCursor('s1');
			ledger.record(exec({ code: 'evicted' }));
			ledger.record(exec({ code: 'kept 1' }));
			ledger.record(exec({ code: 'kept 2' }));
			expect(ledger.consumeAlert('s1', 1)).toBe(
				'[context: earlier events dropped (buffer full) | 2 new console executions | seq 0]');
			// Consumed: the drop is not re-reported once the cursor is past it.
			ledger.record(exec({ code: 'later' }));
			expect(ledger.consumeAlert('s1', 1)).toBe('[context: 1 new console execution | seq 3]');
		});

		it('still alerts about a drop when every retained event is filtered out', () => {
			const ledger = new McpContextLedger(1);
			ledger.ensureCursor('s1');
			ledger.record(exec({ code: 'evicted user run' }));
			ledger.record(exec({ causedByMcpSession: 's1', executedBy: 'Claude Code' }));
			expect(ledger.consumeAlert('s1', 1)).toBe('[context: earlier events dropped (buffer full) | seq 0]');
		});

		it('raises no drop signals when only MCP-attributed events were evicted', () => {
			const ledger = new McpContextLedger(1);
			ledger.ensureCursor('s1');
			ledger.record(exec({ causedByMcpSession: 's2', executedBy: 'Codex' }));
			ledger.record(exec({ code: 'kept user run' }));
			// No alert would ever have flagged the evicted event, so its loss
			// owes nobody an "events dropped" marker or an eviction note.
			expect(ledger.consumeAlert('s1', 1)).toBe('[context: 1 new console execution | seq 0]');
			expect(ledger.query({ mcpSessionId: 's1', since: 0 }, 1).eventsEvicted).toBe(false);
		});
	});

	describe('advanceCursor coverage hint', () => {
		const allSections = [...MCP_USER_CONTEXT_SECTIONS];

		it('offers the advance when the include set covers every category with unattributed events', () => {
			const ledger = new McpContextLedger();
			ledger.record(exec());
			expect(ledger.query({ mcpSessionId: 's1', include: allSections }, 1).advanceCursor).toEqual({ to: 1, reportedSince: undefined });
			expect(ledger.query({ mcpSessionId: 's1', since: 0, include: allSections }, 1).advanceCursor).toEqual({ to: 1, reportedSince: 0 });
		});

		it('withholds the advance when include is absent or skips a category with user events', () => {
			const ledger = new McpContextLedger();
			ledger.record(exec());
			ledger.record(change('editor-change', { change: 'editor' }));
			expect(ledger.query({ mcpSessionId: 's1' }, 1).advanceCursor).toBeUndefined();
			// errors alone misses ok executions.
			expect(ledger.query({ mcpSessionId: 's1', include: ['errors'] }, 1).advanceCursor).toBeUndefined();
			// console covered, but the editor change is not.
			expect(ledger.query({ mcpSessionId: 's1', include: ['console', 'errors'] }, 1).advanceCursor).toBeUndefined();
		});

		it('ignores attributed events when judging coverage (an alert would not flag them)', () => {
			const ledger = new McpContextLedger();
			ledger.record(exec({ causedByMcpSession: 's1', executedBy: 'Claude Code' }));
			ledger.record(change('editor-change', { change: 'editor', causedByMcpSession: 's2' }));
			// No unattributed events at all: even a narrow response covers alerts.
			expect(ledger.query({ mcpSessionId: 's1', include: ['session'] }, 1).advanceCursor).toEqual({ to: 2, reportedSince: undefined });
		});

		it('withholds the advance when the maxConsoleEntries cap cut unattributed executions', () => {
			const ledger = new McpContextLedger();
			for (let i = 0; i < 3; i++) {
				ledger.record(exec({ code: `run ${i}` }));
			}
			// A count in a note is not the content the client is owed.
			expect(ledger.query({ mcpSessionId: 's1', maxConsoleEntries: 2, include: allSections }, 1).advanceCursor).toBeUndefined();
			expect(ledger.query({ mcpSessionId: 's1', maxConsoleEntries: 3, include: allSections }, 1).advanceCursor).toEqual({ to: 3, reportedSince: undefined });
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

		it('flags a since ahead of the current seq and returns everything', () => {
			const ledger = new McpContextLedger();
			ledger.record(exec());
			const data = ledger.query({ mcpSessionId: 's1', since: 999 }, 1);
			expect(data.sinceOutOfRange).toBe(true);
			expect(data.consoleEvents).toHaveLength(1);
			expect(data.changed).toEqual({ session: true, editor: true, notebooks: true });
		});

		it('flags a since below the base seq (a previous run\'s cursor) instead of silently mis-filtering', () => {
			// The production server bases seqs at the run start time, so any seq
			// a client kept from an earlier run is numerically below the base.
			const ledger = new McpContextLedger(undefined, 5000);
			ledger.record(exec({ code: 'this run' }));
			const data = ledger.query({ mcpSessionId: 's1', since: 481 }, 1);
			expect(data.sinceOutOfRange).toBe(true);
			expect(data.consoleEvents.map(e => e.code)).toEqual(['this run']);
			expect(data.changed).toEqual({ session: true, editor: true, notebooks: true });
			// The base seq itself is a valid since (the pre-alert cursor of a
			// client that connected before any event).
			expect(ledger.query({ mcpSessionId: 's1', since: 5000 }, 1).sinceOutOfRange).toBe(false);
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

		it('flags eviction on a full snapshot (no since) too: the buffer is bounded', () => {
			const ledger = new McpContextLedger(2);
			ledger.record(exec({ code: 'a' }));
			expect(ledger.query({ mcpSessionId: 's1' }, 1).eventsEvicted).toBe(false);
			ledger.record(exec({ code: 'b' }));
			ledger.record(exec({ code: 'c' }));
			expect(ledger.query({ mcpSessionId: 's1' }, 1).eventsEvicted).toBe(true);
		});

		it('scopes eviction signals to the window: a busy other window raises no false alarms', () => {
			const ledger = new McpContextLedger(2);
			ledger.ensureCursor('s1');
			ledger.record(exec({ windowId: 2 }));
			ledger.record(exec({ windowId: 2 }));
			ledger.record(exec({ windowId: 2 })); // evicts a window-2 event
			expect(ledger.query({ mcpSessionId: 's1', since: 0 }, 1).eventsEvicted).toBe(false);
			expect(ledger.consumeAlert('s1', 1)).toBeUndefined();
			// The unscoped view still reports it.
			expect(ledger.query({ mcpSessionId: 's1' }, undefined).eventsEvicted).toBe(true);
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
			// Capacity 4: if all four editor events keep their own slots, the
			// older execution is evicted; wrongful coalescing would leave room
			// and keep it. Occupancy is the observable effect of (not)
			// coalescing content-free markers.
			const ledger = new McpContextLedger(4);
			ledger.record(exec({ code: 'evicted if no coalescing' }));
			ledger.record(change('editor-change', { change: 'selection' }));
			ledger.record(change('editor-change', { change: 'editor' }));
			ledger.record(change('editor-change', { change: 'selection' }));
			ledger.record(change('editor-change', { change: 'selection', causedByMcpSession: 's1' }));
			expect(ledger.highWaterSeq).toBe(5);
			const data = ledger.query({ mcpSessionId: 's1', since: 0 }, 1);
			expect(data.consoleEvents).toEqual([]);
			expect(data.eventsEvicted).toBe(true);
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

	it('accepts a section subset and maxConsoleEntries up to the schema ceiling', () => {
		const parsed = parseUserContextArgs({ include: ['errors', 'console'], since: 42, maxConsoleEntries: 50 });
		expect([...parsed.include].sort()).toEqual(['console', 'errors']);
		expect(parsed.since).toBe(42);
		expect(parsed.maxConsoleEntries).toBe(50);
	});

	it('rejects unknown sections, non-integer since, and out-of-range maxConsoleEntries', () => {
		expect(() => parseUserContextArgs({ include: ['sessions'] })).toThrow(/Unknown include section/);
		expect(() => parseUserContextArgs({ include: 'errors' })).toThrow(/must be an array/);
		expect(() => parseUserContextArgs({ include: [] })).toThrow(/must not be empty/);
		expect(() => parseUserContextArgs({ since: -1 })).toThrow(/non-negative integer/);
		expect(() => parseUserContextArgs({ since: 1.5 })).toThrow(/non-negative integer/);
		expect(() => parseUserContextArgs({ maxConsoleEntries: 0 })).toThrow(/between 1 and 50/);
		// Erroring (not a silent clamp) so a client at the cap that follows the
		// "raise maxConsoleEntries" note learns the ceiling instead of looping.
		expect(() => parseUserContextArgs({ maxConsoleEntries: 51 })).toThrow(/between 1 and 50/);
	});
});

describe('buildUserContextResult', () => {
	const snapshot: IMcpUserContextStateSnapshot = {
		session: { name: 'Python 3.12', languageId: 'python', languageVersion: '3.12.1', mode: 'console', sessionId: 'py-1' },
		editor: { path: '/work/analysis.py', kind: 'text', languageId: 'python', cursor: { line: 4, character: 0 }, selection: null },
		notebooks: [{ path: '/work/nb.ipynb', isToolTarget: true }],
	};

	function data(overrides: Partial<ReturnType<McpContextLedger['query']>> = {}) {
		return {
			seq: 7,
			sinceOutOfRange: false,
			eventsEvicted: false,
			consoleEvents: [],
			consoleEventsOmitted: 0,
			errorEvents: [],
			errorEventsOmitted: 0,
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

	it('includes everything and a note when since was out of range', () => {
		// The ledger ignores an out-of-range since, so changed.* come back true.
		const args = parseUserContextArgs({ since: 99 });
		const result = buildUserContextResult(args, data({ sinceOutOfRange: true }), snapshot);
		const response = parse(result);
		expect(response.note).toContain('reset when Positron restarts');
		expect(response.session).toEqual(snapshot.session);
		expect(response.notebooks).toEqual(snapshot.notebooks);
	});

	it('notes eviction when events after since were dropped', () => {
		const result = buildUserContextResult(parseUserContextArgs({ since: 1 }), data({ eventsEvicted: true }), snapshot);
		expect(parse(result).note).toContain('dropped');
	});

	it('notes how many console executions and errors the maxConsoleEntries cap omitted', () => {
		const result = buildUserContextResult(parseUserContextArgs({}), data({ consoleEventsOmitted: 3, errorEventsOmitted: 1 }), snapshot);
		expect(parse(result).note).toContain('3 older console executions were omitted; raise maxConsoleEntries');
		expect(parse(result).note).toContain('1 older error was omitted; raise maxConsoleEntries');
		// No note when the sections were not requested.
		const withoutConsole = buildUserContextResult(parseUserContextArgs({ include: ['session'] }), data({ consoleEventsOmitted: 3, errorEventsOmitted: 1 }), snapshot);
		expect(parse(withoutConsole).note).toBeUndefined();
		// At the cap "raise it" would be rejected by the parser: say the truth.
		const atCap = buildUserContextResult(parseUserContextArgs({ maxConsoleEntries: 50 }), data({ consoleEventsOmitted: 3 }), snapshot);
		expect(parse(atCap).note).toContain('beyond the maxConsoleEntries cap (50) and not retrievable');
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

		const withEvents = buildUserContextResult(parseUserContextArgs({}), data({ consoleEvents: [{ ...exec(), seq: 3 }] }), snapshot);
		expect(withEvents.auditHint?.returnedConsoleContent).toBe(true);

		const stateOnly = buildUserContextResult(parseUserContextArgs({ include: ['session'] }), data(), snapshot);
		expect(stateOnly.auditHint?.returnedConsoleContent).toBeUndefined();
	});

	it('carries the ledger\'s cursor-advance hint through unchanged', () => {
		// The coverage rule lives in the ledger (see the advanceCursor coverage
		// tests above); the composer only forwards its verdict.
		const withHint = buildUserContextResult(parseUserContextArgs({ since: 4 }), data({ advanceCursor: { to: 7, reportedSince: 4 } }), snapshot);
		expect(withHint.auditHint?.advanceContextCursor).toEqual({ to: 7, reportedSince: 4 });

		const withoutHint = buildUserContextResult(parseUserContextArgs({}), data(), snapshot);
		expect(withoutHint.auditHint?.advanceContextCursor).toBeUndefined();
	});
});
