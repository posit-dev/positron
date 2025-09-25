/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../../base/common/event.js';
import { IDisposable } from '../../../../../base/common/lifecycle.js';
import { ICodeEditor } from '../../../../../editor/browser/editorBrowser.js';
import { DidNavigateInputHistoryUpEventArgs, IPositronConsoleInstance, IPositronConsoleService, PositronConsoleState, SessionAttachMode } from '../../browser/interfaces/positronConsoleService.js';
import { RuntimeItem } from '../../browser/classes/runtimeItem.js';
import { ILanguageRuntimeMetadata, RuntimeCodeExecutionMode, RuntimeErrorBehavior } from '../../../languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession, IRuntimeSessionMetadata } from '../../../runtimeSession/common/runtimeSessionService.js';
import { IExecutionHistoryEntry } from '../../../positronHistory/common/executionHistoryService.js';
import { CodeAttributionSource, IConsoleCodeAttribution, ILanguageRuntimeCodeExecutedEvent } from '../../common/positronConsoleCodeExecution.js';

/**
 * Implementation of IPositronConsoleService for use in tests.
 */
export class TestPositronConsoleService implements IPositronConsoleService {
	declare readonly _serviceBrand: undefined;

	/**
	 * The list of Positron console instances.
	 */
	private readonly _positronConsoleInstances: IPositronConsoleInstance[] = [];

	/**
	 * The active Positron console instance.
	 */
	private _activePositronConsoleInstance?: IPositronConsoleInstance;

	/**
	 * The console width in characters.
	 */
	private _consoleWidth: number = 80;

	/**
	 * The onDidStartPositronConsoleInstance event emitter.
	 */
	private readonly _onDidStartPositronConsoleInstanceEmitter = new Emitter<IPositronConsoleInstance>();

	/**
	 * The onDidDeletePositronConsoleInstance event emitter.
	 */
	private readonly _onDidDeletePositronConsoleInstanceEmitter = new Emitter<IPositronConsoleInstance>();

	/**
	 * The onDidChangeActivePositronConsoleInstance event emitter.
	 */
	private readonly _onDidChangeActivePositronConsoleInstanceEmitter = new Emitter<IPositronConsoleInstance | undefined>();

	/**
	 * The onDidChangeConsoleWidth event emitter.
	 */
	private readonly _onDidChangeConsoleWidthEmitter = new Emitter<number>();

	/**
	 * The onDidExecuteCode event emitter.
	 */
	private readonly _onDidExecuteCodeEmitter = new Emitter<ILanguageRuntimeCodeExecutedEvent>();

	/**
	 * Gets the Positron console instances.
	 */
	get positronConsoleInstances(): IPositronConsoleInstance[] {
		return this._positronConsoleInstances;
	}

	/**
	 * Gets the active Positron console instance.
	 */
	get activePositronConsoleInstance(): IPositronConsoleInstance | undefined {
		return this._activePositronConsoleInstance;
	}

	/**
	 * Gets the active code editor for the active Positron console instance.
	 */
	get activeCodeEditor(): ICodeEditor | undefined {
		return this._activePositronConsoleInstance?.codeEditor;
	}

	/**
	 * The onDidStartPositronConsoleInstance event.
	 */
	get onDidStartPositronConsoleInstance(): Event<IPositronConsoleInstance> {
		return this._onDidStartPositronConsoleInstanceEmitter.event;
	}

	/**
	 * The onDidDeletePositronConsoleInstance event.
	 */
	get onDidDeletePositronConsoleInstance(): Event<IPositronConsoleInstance> {
		return this._onDidDeletePositronConsoleInstanceEmitter.event;
	}

	/**
	 * The onDidChangeActivePositronConsoleInstance event.
	 */
	get onDidChangeActivePositronConsoleInstance(): Event<IPositronConsoleInstance | undefined> {
		return this._onDidChangeActivePositronConsoleInstanceEmitter.event;
	}

	/**
	 * The onDidChangeConsoleWidth event.
	 */
	get onDidChangeConsoleWidth(): Event<number> {
		return this._onDidChangeConsoleWidthEmitter.event;
	}

	/**
	 * The onDidExecuteCode event.
	 */
	get onDidExecuteCode(): Event<ILanguageRuntimeCodeExecutedEvent> {
		return this._onDidExecuteCodeEmitter.event;
	}

	/**
	 * Set the active console instance to the one with the given session ID.
	 * @param sessionId The session ID of the console to activate.
	 */
	setActivePositronConsoleSession(sessionId: string): void {
		const instance = this._positronConsoleInstances.find(instance => instance.sessionId === sessionId);
		this._activePositronConsoleInstance = instance;
		this._onDidChangeActivePositronConsoleInstanceEmitter.fire(instance);
	}

	/**
	 * Remove the console instance with the given session ID.
	 * @param sessionId The session ID of the console to delete.
	 */
	deletePositronConsoleSession(sessionId: string): void {
		const index = this._positronConsoleInstances.findIndex(instance => instance.sessionId === sessionId);
		if (index !== -1) {
			const instance = this._positronConsoleInstances[index];
			this._positronConsoleInstances.splice(index, 1);
			this._onDidDeletePositronConsoleInstanceEmitter.fire(instance);

			// If the active instance was deleted, set active to undefined
			if (this._activePositronConsoleInstance?.sessionId === sessionId) {
				this._activePositronConsoleInstance = undefined;
				this._onDidChangeActivePositronConsoleInstanceEmitter.fire(undefined);
			}
		}
	}

	/**
	 * Initializes the service.
	 */
	initialize(): void {
		// No-op for test implementation
	}

	/**
	 * Gets the current console input width, in characters.
	 */
	getConsoleWidth(): number {
		return this._consoleWidth;
	}

	/**
	 * Executes code in a PositronConsoleInstance.
	 */
	async executeCode(
		languageId: string,
		sessionId: string | undefined,
		code: string,
		attribution: IConsoleCodeAttribution,
		focus: boolean,
		allowIncomplete?: boolean,
		mode?: RuntimeCodeExecutionMode,
		errorBehavior?: RuntimeErrorBehavior,
		executionId?: string
	): Promise<string> {
		// Create a code executed event
		const event = this.createTestCodeExecutedEvent(languageId, code, attribution);

		// Fire the code executed event
		this._onDidExecuteCodeEmitter.fire(event);

		return event.sessionId;
	}

	/**
	 * Adds a test console instance to the service.
	 * @param instance The instance to add.
	 */
	addTestConsoleInstance(instance: IPositronConsoleInstance): void {
		this._positronConsoleInstances.push(instance);
		this._activePositronConsoleInstance = instance;
		this._onDidStartPositronConsoleInstanceEmitter.fire(instance);
	}

	/**
	 * Sets the console width.
	 * @param width The new width in characters.
	 */
	setConsoleWidth(width: number): void {
		if (this._consoleWidth !== width) {
			this._consoleWidth = width;
			this._onDidChangeConsoleWidthEmitter.fire(width);
		}
	}

	/**
	 * Creates a test code execution event.
	 */
	createTestCodeExecutedEvent(
		languageId: string,
		code: string,
		attribution: IConsoleCodeAttribution = { source: CodeAttributionSource.Interactive },
		executionId = 'test-execution-id',
		runtimeName: string = 'Test Runtime',
		mode: RuntimeCodeExecutionMode = RuntimeCodeExecutionMode.Interactive,
		errorBehavior: RuntimeErrorBehavior = RuntimeErrorBehavior.Continue
	): ILanguageRuntimeCodeExecutedEvent {
		// Try to use the active console, or fall back to a dummy session ID
		const sessionId = this._activePositronConsoleInstance?.sessionId || 'test-session-id';
		return {
			executionId,
			sessionId,
			languageId,
			code,
			attribution,
			runtimeName,
			mode,
			errorBehavior
		};
	}

	/**
	 * Fires a test code executed event.
	 */
	fireTestCodeExecutedEvent(event: ILanguageRuntimeCodeExecutedEvent): void {
		this._onDidExecuteCodeEmitter.fire(event);
	}

	createInstanceForSession(session: ILanguageRuntimeSession): IPositronConsoleInstance {
		const instance = new TestPositronConsoleInstance(
			session.sessionId,
			'dummy-session-name',
			session.metadata,
			session.runtimeMetadata,
			[], // No runtime items for test instance
			undefined // No code editor for test instance
		);
		this.addTestConsoleInstance(instance);
		return instance;
	}
}

/**
 * Test implementation of IPositronConsoleInstance for use in tests.
 */
export class TestPositronConsoleInstance implements IPositronConsoleInstance {
	private readonly _onFocusInputEmitter = new Emitter<void>();
	private readonly _onDidChangeStateEmitter = new Emitter<PositronConsoleState>();
	private readonly _onDidChangeWordWrapEmitter = new Emitter<boolean>();
	private readonly _onDidChangeTraceEmitter = new Emitter<boolean>();
	private readonly _onDidChangeRuntimeItemsEmitter = new Emitter<void>();
	private readonly _onDidPasteTextEmitter = new Emitter<string>();
	private readonly _onDidSelectAllEmitter = new Emitter<void>();
	private readonly _onDidClearConsoleEmitter = new Emitter<void>();
	private readonly _onDidNavigateInputHistoryDownEmitter = new Emitter<void>();
	private readonly _onDidNavigateInputHistoryUpEmitter = new Emitter<DidNavigateInputHistoryUpEventArgs>();
	private readonly _onDidClearInputHistoryEmitter = new Emitter<void>();
	private readonly _onDidSetPendingCodeEmitter = new Emitter<string | undefined>();
	private readonly _onDidExecuteCodeEmitter = new Emitter<ILanguageRuntimeCodeExecutedEvent>();
	private readonly _onDidSelectPlotEmitter = new Emitter<string>();
	private readonly _onDidRequestRestartEmitter = new Emitter<void>();
	private readonly _onDidAttachSessionEmitter = new Emitter<ILanguageRuntimeSession | undefined>();
	private readonly _onDidChangeWidthInCharsEmitter = new Emitter<number>();

	private _state: PositronConsoleState = PositronConsoleState.Ready;
	private _trace: boolean = false;
	private _wordWrap: boolean = true;
	private _promptActive: boolean = false;
	private _runtimeAttached: boolean = true;
	private _widthInChars: number = 80;
	private _initialWorkingDirectory: string = '';
	private _attachedRuntimeSession?: ILanguageRuntimeSession;

	constructor(
		public readonly sessionId: string,
		public readonly sessionName: string,
		public readonly sessionMetadata: IRuntimeSessionMetadata,
		public readonly runtimeMetadata: ILanguageRuntimeMetadata,
		public readonly runtimeItems: RuntimeItem[] = [],
		public readonly codeEditor: ICodeEditor | undefined = undefined
	) { }

	get onFocusInput(): Event<void> {
		return this._onFocusInputEmitter.event;
	}

	get onDidChangeState(): Event<PositronConsoleState> {
		return this._onDidChangeStateEmitter.event;
	}

	get onDidChangeWordWrap(): Event<boolean> {
		return this._onDidChangeWordWrapEmitter.event;
	}

	get onDidChangeTrace(): Event<boolean> {
		return this._onDidChangeTraceEmitter.event;
	}

	get onDidChangeRuntimeItems(): Event<void> {
		return this._onDidChangeRuntimeItemsEmitter.event;
	}

	get onDidPasteText(): Event<string> {
		return this._onDidPasteTextEmitter.event;
	}

	get onDidSelectAll(): Event<void> {
		return this._onDidSelectAllEmitter.event;
	}

	get onDidClearConsole(): Event<void> {
		return this._onDidClearConsoleEmitter.event;
	}

	get onDidNavigateInputHistoryDown(): Event<void> {
		return this._onDidNavigateInputHistoryDownEmitter.event;
	}

	get onDidNavigateInputHistoryUp(): Event<DidNavigateInputHistoryUpEventArgs> {
		return this._onDidNavigateInputHistoryUpEmitter.event;
	}

	get onDidClearInputHistory(): Event<void> {
		return this._onDidClearInputHistoryEmitter.event;
	}

	get onDidSetPendingCode(): Event<string | undefined> {
		return this._onDidSetPendingCodeEmitter.event;
	}

	get onDidExecuteCode(): Event<ILanguageRuntimeCodeExecutedEvent> {
		return this._onDidExecuteCodeEmitter.event;
	}

	get onDidSelectPlot(): Event<string> {
		return this._onDidSelectPlotEmitter.event;
	}

	get onDidRequestRestart(): Event<void> {
		return this._onDidRequestRestartEmitter.event;
	}

	get onDidAttachSession(): Event<ILanguageRuntimeSession | undefined> {
		return this._onDidAttachSessionEmitter.event;
	}

	get onDidChangeWidthInChars(): Event<number> {
		return this._onDidChangeWidthInCharsEmitter.event;
	}

	get state(): PositronConsoleState {
		return this._state;
	}

	get trace(): boolean {
		return this._trace;
	}

	get wordWrap(): boolean {
		return this._wordWrap;
	}

	get promptActive(): boolean {
		return this._promptActive;
	}

	get runtimeAttached(): boolean {
		return this._runtimeAttached;
	}

	scrollLocked: boolean = false;
	lastScrollTop: number = 0;

	setState(state: PositronConsoleState): void {
		this._state = state;
		this._onDidChangeStateEmitter.fire(state);
	}

	setTrace(trace: boolean): void {
		this._trace = trace;
		this._onDidChangeTraceEmitter.fire(trace);
	}

	setWordWrap(wordWrap: boolean): void {
		this._wordWrap = wordWrap;
		this._onDidChangeWordWrapEmitter.fire(wordWrap);
	}

	setPromptActive(promptActive: boolean): void {
		this._promptActive = promptActive;
	}

	setRuntimeAttached(runtimeAttached: boolean): void {
		this._runtimeAttached = runtimeAttached;
	}

	addDisposables(_disposables: IDisposable): void {
		// No-op for test implementation
	}

	focusInput(): void {
		this._onFocusInputEmitter.fire();
	}

	setWidthInChars(newWidth: number): void {
		if (this._widthInChars !== newWidth) {
			this._widthInChars = newWidth;
			this._onDidChangeWidthInCharsEmitter.fire(newWidth);
		}
	}

	getWidthInChars(): number {
		return this._widthInChars;
	}

	toggleTrace(): void {
		this.setTrace(!this._trace);
	}

	toggleWordWrap(): void {
		this.setWordWrap(!this._wordWrap);
	}

	pasteText(text: string): void {
		this._onDidPasteTextEmitter.fire(text);
	}

	selectAll(): void {
		this._onDidSelectAllEmitter.fire();
	}

	clearConsole(): void {
		this._onDidClearConsoleEmitter.fire();
	}

	navigateInputHistoryDown(): void {
		this._onDidNavigateInputHistoryDownEmitter.fire();
	}

	navigateInputHistoryUp(usingPrefixMatch: boolean): void {
		this._onDidNavigateInputHistoryUpEmitter.fire({
			usingPrefixMatch,
		});
	}

	clearInputHistory(): void {
		this._onDidClearInputHistoryEmitter.fire();
	}

	setPendingCode(code: string | undefined): void {
		this._onDidSetPendingCodeEmitter.fire(code);
	}

	restartSession(): void {
		this._onDidRequestRestartEmitter.fire();
	}

	/**
	 * Execute code in the console.
	 * @param code The code to execute.
	 * @param attribution Attribution for the code.
	 * @param mode Runtime execution mode.
	 * @param errorBehavior Runtime error behavior.
	 * @param executionId Optional execution ID.
	 */
	executeCode(
		code: string,
		attribution: IConsoleCodeAttribution,
		mode?: RuntimeCodeExecutionMode,
		errorBehavior?: RuntimeErrorBehavior,
		executionId = 'test-execution-id'
	): void {
		const event: ILanguageRuntimeCodeExecutedEvent = {
			executionId,
			sessionId: this.sessionId,
			languageId: this.runtimeMetadata.languageId,
			code,
			attribution,
			runtimeName: this.runtimeMetadata.runtimeName,
			mode: mode || RuntimeCodeExecutionMode.Interactive,
			errorBehavior: errorBehavior || RuntimeErrorBehavior.Continue
		};
		this._onDidExecuteCodeEmitter.fire(event);
	}

	/**
	 * Fire a custom code execution event.
	 * @param event The code execution event to fire.
	 */
	fireCodeExecutionEvent(event: ILanguageRuntimeCodeExecutedEvent): void {
		this._onDidExecuteCodeEmitter.fire(event);
	}

	selectPlot(plot: string): void {
		this._onDidSelectPlotEmitter.fire(plot);
	}

	/**
	 * Interrupts the console.
	 */
	interrupt(code: string): void {
		// No-op for test implementation
	}

	/**
	 * Gets the clipboard representation of the console instance.
	 */
	getClipboardRepresentation(commentPrefix: string): string[] {
		return [];
	}

	/**
	 * Replays execution history entries.
	 */
	replayExecutions(entries: IExecutionHistoryEntry<any>[]): void {
		// No-op for test implementation
	}

	/**
	 * Gets or sets the initial working directory displayed in the console.
	 */
	get initialWorkingDirectory(): string {
		return this._initialWorkingDirectory;
	}

	set initialWorkingDirectory(value: string) {
		this._initialWorkingDirectory = value;
	}

	/**
	 * Enqueues code to be executed.
	 */
	async enqueueCode(
		code: string,
		attribution: IConsoleCodeAttribution,
		allowIncomplete?: boolean,
		mode?: RuntimeCodeExecutionMode,
		errorBehavior?: RuntimeErrorBehavior,
		executionId?: string
	): Promise<void> {
		this.executeCode(code, attribution, mode, errorBehavior, executionId);
	}

	/**
	 * Replies to a prompt.
	 */
	replyToPrompt(value: string): void {
		// No-op for test implementation
	}

	/**
	 * Attaches a runtime session to the console.
	 */
	attachRuntimeSession(session: ILanguageRuntimeSession | undefined, mode: SessionAttachMode): void {
		this._attachedRuntimeSession = session;
		this._runtimeAttached = !!session;
		this._onDidAttachSessionEmitter.fire(session);
	}

	/**
	 * Gets the currently attached runtime, or undefined if none.
	 */
	get attachedRuntimeSession(): ILanguageRuntimeSession | undefined {
		return this._attachedRuntimeSession;
	}

	/**
	 * Attach a runtime session to this console instance.
	 * @param session The session to attach.
	 */
	attachSession(session: ILanguageRuntimeSession): void {
		this.attachRuntimeSession(session, SessionAttachMode.Connected);
	}

	/**
	 * Detach the current runtime session from this console instance.
	 */
	detachSession(): void {
		this.attachRuntimeSession(undefined, SessionAttachMode.Connected);
	}

	/**
	 * Add a runtime item to this console instance.
	 * @param runtimeItem The runtime item to add.
	 */
	addRuntimeItem(runtimeItem: RuntimeItem): void {
		(this.runtimeItems as RuntimeItem[]).push(runtimeItem);
		this._onDidChangeRuntimeItemsEmitter.fire();
	}
}
