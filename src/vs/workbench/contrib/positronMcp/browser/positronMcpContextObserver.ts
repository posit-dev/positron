/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { RunOnceScheduler } from '../../../../base/common/async.js';
import { Disposable, DisposableMap, DisposableStore, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { isCodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IPositronMcpService } from '../../../../platform/positronMcp/common/positronMcp.js';
import { MAX_CONTEXT_FIELD_LENGTH, McpContextEventInput } from '../../../../platform/positronMcp/common/positronMcpContext.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import {
	ILanguageRuntimeMessage,
	RuntimeCodeExecutionMode,
	RuntimeOnlineState,
} from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { IPositronConsoleService } from '../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import {
	CodeAttributionSource,
	IConsoleCodeAttribution,
	ILanguageRuntimeCodeExecutedEvent,
} from '../../../services/positronConsole/common/positronConsoleCodeExecution.js';
import { ILanguageRuntimeSession, IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { IPositronNotebookService } from '../../positronNotebook/browser/positronNotebookService.js';
import { IPositronMcpToolService } from './positronMcpToolService.js';

/** Trailing debounce for selection moves, so a drag records one event, not dozens. */
const SELECTION_DEBOUNCE_MS = 1000;

/** Cap on executions awaiting settlement; beyond it the oldest is flushed as-is. */
const MAX_PENDING_EXECUTIONS = 50;

/** A console execution we saw submitted and are waiting to settle. */
interface IPendingExecution {
	readonly executionId: string;
	readonly sessionId: string;
	readonly timestamp: number;
	readonly languageId: string;
	readonly code: string;
	readonly executedBy: string;
	readonly causedByMcpSession?: string;
	output: string;
	error?: { name: string; message: string; traceback: string[] };
}

/** The display label for who ran a console execution, from its attribution. */
function executedByLabel(attribution: IConsoleCodeAttribution): string {
	switch (attribution.source) {
		case CodeAttributionSource.ExternalAgent: {
			const displayName = attribution.metadata?.displayName;
			return typeof displayName === 'string' && displayName.length > 0 ? displayName : 'external agent';
		}
		case CodeAttributionSource.Assistant:
			return 'assistant';
		case CodeAttributionSource.Extension:
			return 'extension';
		default:
			// Interactive, Paste, Script, Notebook: all user-driven paths.
			return 'user';
	}
}

/**
 * Watches this window for the bounded set of user-activity events the MCP
 * server's context ledger records -- console executions (with their outcome),
 * active editor / selection changes, notebook open/close, and foreground
 * session changes -- and pushes each one to the main process, which assigns
 * the sequence numbers. Deliberately not a general event bus: nothing else
 * (settings, terminals, keystrokes, window focus) is observed.
 *
 * The lifecycle contribution creates one observer per window while the MCP
 * server should be running and disposes it otherwise, so no console content
 * ever leaves the renderer while the server is off.
 *
 * Attribution: a console execution is tied to the MCP session that requested
 * it via the attribution metadata execute-code writes; editor/notebook/session
 * events carry the tool service's currently-active caller, so a client's own
 * open-document or notebook-create is never echoed back to it as user
 * activity.
 */
export class PositronMcpContextObserver extends Disposable {
	/** Executions submitted but not yet settled, keyed by execution id. */
	private readonly _pending = new Map<string, IPendingExecution>();

	/** Per-runtime-session message listeners, dropped when the session ends. */
	private readonly _sessionListeners = this._register(new DisposableMap<string>());

	private readonly _selectionListener = this._register(new MutableDisposable());

	constructor(
		private readonly _windowId: number,
		@IPositronMcpService private readonly _mcpService: IPositronMcpService,
		@IPositronConsoleService consoleService: IPositronConsoleService,
		@IRuntimeSessionService private readonly _runtimeSessionService: IRuntimeSessionService,
		@IEditorService private readonly _editorService: IEditorService,
		@IPositronNotebookService notebookService: IPositronNotebookService,
		@IPositronMcpToolService private readonly _toolService: IPositronMcpToolService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();

		// --- Console executions -------------------------------------------------
		this._register(consoleService.onDidExecuteCode(event => this._onDidExecuteCode(event)));
		for (const active of this._runtimeSessionService.getActiveSessions()) {
			this._watchSession(active.session);
		}
		this._register(this._runtimeSessionService.onWillStartSession(event => this._watchSession(event.session)));

		// --- Active editor / selection ------------------------------------------
		this._register(this._editorService.onDidActiveEditorChange(() => {
			this._push({ kind: 'editor-change', change: 'editor', windowId: this._windowId, timestamp: Date.now(), causedByMcpSession: this._activeCallerId() });
			this._hookSelection();
		}));
		this._hookSelection();

		// --- Notebooks ------------------------------------------------------------
		this._register(notebookService.onDidAddNotebookInstance(() => {
			this._push({ kind: 'notebook-open', windowId: this._windowId, timestamp: Date.now(), causedByMcpSession: this._activeCallerId() });
		}));
		this._register(notebookService.onDidRemoveNotebookInstance(() => {
			this._push({ kind: 'notebook-close', windowId: this._windowId, timestamp: Date.now(), causedByMcpSession: this._activeCallerId() });
		}));

		// --- Foreground session ----------------------------------------------------
		this._register(this._runtimeSessionService.onDidChangeForegroundSession(() => {
			this._push({ kind: 'session-change', windowId: this._windowId, timestamp: Date.now(), causedByMcpSession: this._activeCallerId() });
		}));
	}

	override dispose(): void {
		// Flush what we know about still-running executions rather than losing them.
		for (const pending of [...this._pending.values()]) {
			this._settle(pending, 'unknown');
		}
		super.dispose();
	}

	private _activeCallerId(): string | undefined {
		return this._toolService.activeCaller?.mcpSessionId;
	}

	private _push(event: McpContextEventInput): void {
		this._mcpService.recordContextEvent(event)
			.catch(error => this._logService.warn('[PositronMcp] Failed to record context event', error));
	}

	// --- Console executions ----------------------------------------------------

	private _onDidExecuteCode(event: ILanguageRuntimeCodeExecutedEvent): void {
		// Silent executions are invisible to the user (background inspections,
		// completions); they are not user-relevant activity.
		if (event.mode === RuntimeCodeExecutionMode.Silent) {
			return;
		}
		const metadata = event.attribution.metadata;
		const mcpSessionId = typeof metadata?.mcpSessionId === 'string' ? metadata.mcpSessionId : undefined;
		this._pending.set(event.executionId, {
			executionId: event.executionId,
			sessionId: event.sessionId,
			timestamp: Date.now(),
			languageId: event.languageId,
			code: event.code,
			executedBy: executedByLabel(event.attribution),
			causedByMcpSession: mcpSessionId,
			output: '',
		});
		// Bound the map: a session that never settles (kernel wedged) must not
		// accumulate executions forever. Flush the oldest with what we have.
		if (this._pending.size > MAX_PENDING_EXECUTIONS) {
			const oldest = this._pending.values().next().value;
			if (oldest) {
				this._settle(oldest, 'unknown');
			}
		}
	}

	/** Subscribe to a session's runtime messages to settle executions we track. */
	private _watchSession(session: ILanguageRuntimeSession): void {
		if (this._sessionListeners.has(session.sessionId)) {
			return;
		}
		const store = new DisposableStore();
		this._sessionListeners.set(session.sessionId, store);

		const pendingFor = (message: ILanguageRuntimeMessage) => this._pending.get(message.parent_id);

		store.add(session.onDidReceiveRuntimeMessageStream(message => {
			const pending = pendingFor(message);
			if (pending && pending.output.length <= MAX_CONTEXT_FIELD_LENGTH) {
				pending.output += message.text;
			}
		}));
		store.add(session.onDidReceiveRuntimeMessageOutput(message => {
			const pending = pendingFor(message);
			const text = pending && message.data['text/plain'];
			if (pending && typeof text === 'string' && pending.output.length <= MAX_CONTEXT_FIELD_LENGTH) {
				pending.output += text;
			}
		}));
		store.add(session.onDidReceiveRuntimeMessageError(message => {
			const pending = pendingFor(message);
			if (pending) {
				pending.error = { name: message.name, message: message.message, traceback: [...(message.traceback ?? [])] };
				this._settle(pending, 'error');
			}
		}));
		store.add(session.onDidReceiveRuntimeMessageState(message => {
			const pending = pendingFor(message);
			if (pending && message.state === RuntimeOnlineState.Idle) {
				this._settle(pending, 'ok');
			}
		}));
		store.add(session.onDidEndSession(() => {
			for (const pending of [...this._pending.values()]) {
				if (pending.sessionId === session.sessionId) {
					this._settle(pending, 'unknown');
				}
			}
			// Deleting disposes the store, including this listener; the Emitter
			// tolerates a listener removing itself mid-dispatch.
			this._sessionListeners.deleteAndDispose(session.sessionId);
		}));
	}

	/** Record a settled execution as one event; safe to call at most once each. */
	private _settle(pending: IPendingExecution, status: 'ok' | 'error' | 'unknown'): void {
		if (!this._pending.delete(pending.executionId)) {
			return;
		}
		this._push({
			kind: 'console-execution',
			windowId: this._windowId,
			timestamp: pending.timestamp,
			languageId: pending.languageId,
			code: pending.code,
			executedBy: pending.executedBy,
			causedByMcpSession: pending.causedByMcpSession,
			status,
			output: pending.output.length > 0 ? pending.output : undefined,
			error: pending.error,
		});
	}

	// --- Selection ---------------------------------------------------------------

	/** Re-hook the debounced selection listener onto the now-active code editor. */
	private _hookSelection(): void {
		this._selectionListener.clear();
		const editor = this._editorService.activeTextEditorControl;
		if (!isCodeEditor(editor)) {
			return;
		}
		// Capture the causer when the selection moves, not when the debounce
		// fires: a tool call that moved the selection may have returned by then.
		let causedByMcpSession: string | undefined;
		const scheduler = new RunOnceScheduler(() => {
			this._push({ kind: 'editor-change', change: 'selection', windowId: this._windowId, timestamp: Date.now(), causedByMcpSession });
		}, SELECTION_DEBOUNCE_MS);
		const listener = editor.onDidChangeCursorSelection(() => {
			causedByMcpSession = this._activeCallerId();
			scheduler.schedule();
		});
		this._selectionListener.value = {
			dispose: () => {
				listener.dispose();
				scheduler.dispose();
			},
		};
	}
}
