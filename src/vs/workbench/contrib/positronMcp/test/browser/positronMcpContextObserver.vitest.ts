/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Emitter } from '../../../../../base/common/event.js';
import { EditorType } from '../../../../../editor/common/editorCommon.js';
import { ICodeEditor } from '../../../../../editor/browser/editorBrowser.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { IPositronMcpService } from '../../../../../platform/positronMcp/common/positronMcp.js';
import { IMcpConsoleExecutionEvent, McpContextEventInput } from '../../../../../platform/positronMcp/common/positronMcpContext.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import {
	ILanguageRuntimeExit,
	ILanguageRuntimeMessageError,
	ILanguageRuntimeMessageOutput,
	ILanguageRuntimeMessageState,
	ILanguageRuntimeMessageStream,
	LanguageRuntimeMessageType,
	RuntimeCodeExecutionMode,
	RuntimeErrorBehavior,
	RuntimeExitReason,
	RuntimeOnlineState,
	RuntimeOutputKind,
} from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { IPositronConsoleService } from '../../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import {
	CodeAttributionSource,
	IConsoleCodeAttribution,
	ILanguageRuntimeCodeExecutedEvent,
} from '../../../../services/positronConsole/common/positronConsoleCodeExecution.js';
import { ActiveRuntimeSession } from '../../../../services/runtimeSession/common/activeRuntimeSession.js';
import { ILanguageRuntimeSession, IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { IPositronNotebookInstance } from '../../../positronNotebook/browser/IPositronNotebookInstance.js';
import { IPositronNotebookService } from '../../../positronNotebook/browser/positronNotebookService.js';
import { PositronMcpContextObserver } from '../../browser/positronMcpContextObserver.js';
import { IPositronMcpToolService } from '../../browser/positronMcpToolService.js';

/** A fake runtime session exposing the emitters the observer subscribes to. */
function fakeSession(sessionId = 'session-1') {
	const stream = new Emitter<ILanguageRuntimeMessageStream>();
	const output = new Emitter<ILanguageRuntimeMessageOutput>();
	const error = new Emitter<ILanguageRuntimeMessageError>();
	const state = new Emitter<ILanguageRuntimeMessageState>();
	const end = new Emitter<ILanguageRuntimeExit>();
	const session = stubInterface<ILanguageRuntimeSession>({
		sessionId,
		onDidReceiveRuntimeMessageStream: stream.event,
		onDidReceiveRuntimeMessageOutput: output.event,
		onDidReceiveRuntimeMessageError: error.event,
		onDidReceiveRuntimeMessageState: state.event,
		onDidEndSession: end.event,
	});
	return { session, stream, output, error, state, end };
}

function base(type: LanguageRuntimeMessageType, parentId: string) {
	return { id: 'm', type, event_clock: 0, parent_id: parentId, when: '' };
}

function executedEvent(overrides: Partial<ILanguageRuntimeCodeExecutedEvent> = {}, attribution?: Partial<IConsoleCodeAttribution>): ILanguageRuntimeCodeExecutedEvent {
	return {
		executionId: 'exec-1',
		sessionId: 'session-1',
		languageId: 'python',
		code: 'x = 1',
		attribution: { source: CodeAttributionSource.Interactive, ...attribution },
		runtimeName: 'Python',
		mode: RuntimeCodeExecutionMode.Interactive,
		errorBehavior: RuntimeErrorBehavior.Stop,
		...overrides,
	};
}

/** A minimal fake code editor: enough for isCodeEditor() and selection hooks. */
function fakeCodeEditor() {
	const selection = new Emitter<unknown>();
	const editor = stubInterface<ICodeEditor>({
		getEditorType: () => EditorType.ICodeEditor,
		onDidChangeCursorSelection: selection.event as ICodeEditor['onDidChangeCursorSelection'],
	});
	return { editor, selection };
}

/** Build an observer over stub services; returns the emitters and the recorded events. */
function createObserver(options: { activeEditor?: ICodeEditor } = {}) {
	const recorded: McpContextEventInput[] = [];
	const mcpService = stubInterface<IPositronMcpService>({
		recordContextEvent: vi.fn(async (event: McpContextEventInput) => { recorded.push(event); }),
	});

	const didExecuteCode = new Emitter<ILanguageRuntimeCodeExecutedEvent>();
	const consoleService = stubInterface<IPositronConsoleService>({ onDidExecuteCode: didExecuteCode.event });

	const runtime = fakeSession();
	const willStartSession = new Emitter<{ session: ILanguageRuntimeSession }>();
	const foregroundChange = new Emitter<ILanguageRuntimeSession | undefined>();
	const sessionService = stubInterface<IRuntimeSessionService>({
		getActiveSessions: () => [stubInterface<ActiveRuntimeSession>({ session: runtime.session })],
		onWillStartSession: willStartSession.event as IRuntimeSessionService['onWillStartSession'],
		onDidChangeForegroundSession: foregroundChange.event,
	});

	const activeEditorChange = new Emitter<void>();
	const editorService = stubInterface<IEditorService>({
		onDidActiveEditorChange: activeEditorChange.event,
		activeTextEditorControl: options.activeEditor,
	});

	const notebookAdd = new Emitter<IPositronNotebookInstance>();
	const notebookRemove = new Emitter<IPositronNotebookInstance>();
	const notebookService = stubInterface<IPositronNotebookService>({
		onDidAddNotebookInstance: notebookAdd.event,
		onDidRemoveNotebookInstance: notebookRemove.event,
	});

	// Mutable so tests can simulate a tool call being in flight.
	const toolService = stubInterface<IPositronMcpToolService>({ activeToolCall: undefined });

	const observer = new PositronMcpContextObserver(
		7, mcpService, consoleService, sessionService, editorService, notebookService, toolService, new NullLogService());

	return { observer, recorded, didExecuteCode, runtime, willStartSession, foregroundChange, activeEditorChange, notebookAdd, notebookRemove, toolService };
}

describe('PositronMcpContextObserver', () => {
	describe('console executions', () => {
		it('records one settled event per execution: user attribution, streamed output, ok status', () => {
			const ctx = createObserver();
			ctx.didExecuteCode.fire(executedEvent());
			ctx.runtime.stream.fire({ ...base(LanguageRuntimeMessageType.Stream, 'exec-1'), name: 'stdout', text: 'hello ' });
			ctx.runtime.output.fire({ ...base(LanguageRuntimeMessageType.Output, 'exec-1'), kind: RuntimeOutputKind.Text, data: { 'text/plain': 'world' } });
			// Nothing is pushed until the execution settles.
			expect(ctx.recorded).toEqual([]);
			ctx.runtime.state.fire({ ...base(LanguageRuntimeMessageType.State, 'exec-1'), state: RuntimeOnlineState.Idle });

			expect(ctx.recorded).toEqual([{
				kind: 'console-execution',
				windowId: 7,
				timestamp: expect.any(Number),
				languageId: 'python',
				code: 'x = 1',
				executedBy: 'user',
				causedByMcpSession: undefined,
				status: 'ok',
				output: 'hello world',
				error: undefined,
			}]);
			ctx.observer.dispose();
		});

		it('settles an error with its name, message, and traceback', () => {
			const ctx = createObserver();
			ctx.didExecuteCode.fire(executedEvent({ code: '1/0' }));
			ctx.runtime.error.fire({ ...base(LanguageRuntimeMessageType.Error, 'exec-1'), name: 'ZeroDivisionError', message: 'division by zero', traceback: ['File "<console>", line 1'] });

			expect(ctx.recorded).toEqual([expect.objectContaining({
				kind: 'console-execution',
				code: '1/0',
				status: 'error',
				error: { name: 'ZeroDivisionError', message: 'division by zero', traceback: ['File "<console>", line 1'] },
			})]);
			// The later idle transition must not record the execution twice.
			ctx.runtime.state.fire({ ...base(LanguageRuntimeMessageType.State, 'exec-1'), state: RuntimeOnlineState.Idle });
			expect(ctx.recorded).toHaveLength(1);
			ctx.observer.dispose();
		});

		it('bounds error message and traceback before they cross the IPC, like code and output', () => {
			const ctx = createObserver();
			ctx.didExecuteCode.fire(executedEvent({ code: 'recurse()' }));
			ctx.runtime.error.fire({
				...base(LanguageRuntimeMessageType.Error, 'exec-1'),
				name: 'RecursionError',
				message: 'x'.repeat(100_000),
				traceback: Array.from({ length: 3000 }, () => 'y'.repeat(5000)),
			});

			const [event] = ctx.recorded;
			expect(event.kind).toBe('console-execution');
			const error = (event as IMcpConsoleExecutionEvent).error!;
			expect(error.message.length).toBeLessThanOrEqual(2049);
			expect(error.traceback.length).toBeLessThanOrEqual(64);
			expect(error.traceback.every(line => line.length <= 2049)).toBe(true);
			ctx.observer.dispose();
		});

		it('ignores silent executions (invisible background inspections)', () => {
			const ctx = createObserver();
			ctx.didExecuteCode.fire(executedEvent({ mode: RuntimeCodeExecutionMode.Silent }));
			ctx.runtime.state.fire({ ...base(LanguageRuntimeMessageType.State, 'exec-1'), state: RuntimeOnlineState.Idle });
			expect(ctx.recorded).toEqual([]);
			ctx.observer.dispose();
		});

		it('attributes an MCP client\'s execution via the attribution metadata', () => {
			const ctx = createObserver();
			ctx.didExecuteCode.fire(executedEvent({}, {
				source: CodeAttributionSource.ExternalAgent,
				metadata: { source: 'positron-mcp', displayName: 'Claude Code', mcpSessionId: 'mcp-1' },
			}));
			ctx.runtime.state.fire({ ...base(LanguageRuntimeMessageType.State, 'exec-1'), state: RuntimeOnlineState.Idle });

			expect(ctx.recorded).toEqual([expect.objectContaining({
				executedBy: 'Claude Code',
				causedByMcpSession: 'mcp-1',
			})]);
			ctx.observer.dispose();
		});

		it('flushes executions as unknown when their session ends, and watches sessions that start later', () => {
			const ctx = createObserver();
			const late = fakeSession('session-2');
			ctx.willStartSession.fire({ session: late.session });

			ctx.didExecuteCode.fire(executedEvent({ executionId: 'exec-2', sessionId: 'session-2', code: 'sleep()' }));
			late.end.fire({ runtime_name: 'Python', session_name: 'Python 3.12', exit_code: 0, reason: RuntimeExitReason.Shutdown, message: '' });

			expect(ctx.recorded).toEqual([expect.objectContaining({ code: 'sleep()', status: 'unknown' })]);
			ctx.observer.dispose();
		});

		it('drops still-pending executions on dispose without pushing their content', () => {
			// Dispose means MCP was turned off (or the window is closing): the
			// "no console content leaves the renderer while off" guarantee wins
			// over completeness.
			const ctx = createObserver();
			ctx.didExecuteCode.fire(executedEvent({ code: 'while True: pass' }));
			ctx.observer.dispose();
			expect(ctx.recorded).toEqual([]);
		});
	});

	describe('workbench change markers', () => {
		it('records editor, notebook, and foreground-session changes as content-free markers', () => {
			const ctx = createObserver();
			ctx.activeEditorChange.fire();
			ctx.notebookAdd.fire(stubInterface<IPositronNotebookInstance>());
			ctx.notebookRemove.fire(stubInterface<IPositronNotebookInstance>());
			ctx.foregroundChange.fire(undefined);

			expect(ctx.recorded.map(event => event.kind)).toEqual(['editor-change', 'notebook-open', 'notebook-close', 'session-change']);
			expect(ctx.recorded[0]).toEqual({ kind: 'editor-change', change: 'editor', windowId: 7, timestamp: expect.any(Number), causedByMcpSession: undefined });
			ctx.observer.dispose();
		});

		it('attributes changes to an in-flight tool call only when that tool plausibly causes them', () => {
			const ctx = createObserver();
			const toolService = ctx.toolService as { activeToolCall: unknown };

			// open-document plausibly opens a notebook (.ipynb path): attributed.
			toolService.activeToolCall = { caller: { mcpSessionId: 'mcp-1', clientName: 'claude-code' }, toolName: 'open-document' };
			ctx.notebookAdd.fire(stubInterface<IPositronNotebookInstance>());
			expect(ctx.recorded).toEqual([expect.objectContaining({ kind: 'notebook-open', causedByMcpSession: 'mcp-1' })]);

			// A user switching editors during a long execute-code is user
			// activity, not the agent's -- no attribution.
			toolService.activeToolCall = { caller: { mcpSessionId: 'mcp-1', clientName: 'claude-code' }, toolName: 'execute-code' };
			ctx.activeEditorChange.fire();
			expect(ctx.recorded[1]).toEqual(expect.objectContaining({ kind: 'editor-change', causedByMcpSession: undefined }));

			// open-document plausibly changes the active editor: attributed.
			toolService.activeToolCall = { caller: { mcpSessionId: 'mcp-1', clientName: 'claude-code' }, toolName: 'open-document' };
			ctx.activeEditorChange.fire();
			expect(ctx.recorded[2]).toEqual(expect.objectContaining({ kind: 'editor-change', causedByMcpSession: 'mcp-1' }));

			// ...and plausibly flips the foreground session mid-call (opening an
			// .ipynb foregrounds its kernel): attributed, no self-echo.
			ctx.foregroundChange.fire(undefined);
			expect(ctx.recorded[3]).toEqual(expect.objectContaining({ kind: 'session-change', causedByMcpSession: 'mcp-1' }));
			ctx.observer.dispose();
		});

		it('debounces selection moves into one marker, capturing the causer at move time', () => {
			vi.useFakeTimers();
			try {
				const { editor, selection } = fakeCodeEditor();
				const ctx = createObserver({ activeEditor: editor });

				selection.fire(undefined);
				selection.fire(undefined);
				selection.fire(undefined);
				expect(ctx.recorded).toEqual([]);
				vi.advanceTimersByTime(1100);

				expect(ctx.recorded).toEqual([expect.objectContaining({ kind: 'editor-change', change: 'selection', causedByMcpSession: undefined })]);
				ctx.observer.dispose();
			} finally {
				vi.useRealTimers();
			}
		});

		it('a user selection move within the debounce window outranks an agent-caused one', () => {
			vi.useFakeTimers();
			try {
				const { editor, selection } = fakeCodeEditor();
				const ctx = createObserver({ activeEditor: editor });
				const toolService = ctx.toolService as { activeToolCall: unknown };

				// An open-document call moves the selection...
				toolService.activeToolCall = { caller: { mcpSessionId: 'mcp-1', clientName: 'claude-code' }, toolName: 'open-document' };
				selection.fire(undefined);
				// ...then the user moves it before the debounce fires: the
				// coalesced marker must be the user's so it is never hidden.
				toolService.activeToolCall = undefined;
				selection.fire(undefined);
				vi.advanceTimersByTime(1100);
				expect(ctx.recorded).toEqual([expect.objectContaining({ change: 'selection', causedByMcpSession: undefined })]);

				// Agent-only moves in the next window attribute to the agent
				// again (the user-wins latch resets between markers).
				toolService.activeToolCall = { caller: { mcpSessionId: 'mcp-1', clientName: 'claude-code' }, toolName: 'open-document' };
				selection.fire(undefined);
				vi.advanceTimersByTime(1100);
				expect(ctx.recorded[1]).toEqual(expect.objectContaining({ change: 'selection', causedByMcpSession: 'mcp-1' }));
				ctx.observer.dispose();
			} finally {
				vi.useRealTimers();
			}
		});
	});
});
