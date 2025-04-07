/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as positron from 'positron';
import { debounce } from '../../../../base/common/decorators.js';
import { ILanguageRuntimeMessage, ILanguageRuntimeMessageCommClosed, ILanguageRuntimeMessageCommData, ILanguageRuntimeMessageCommOpen, ILanguageRuntimeMessageStream, ILanguageRuntimeMessageOutput, ILanguageRuntimeMessageState, ILanguageRuntimeMetadata, LanguageRuntimeSessionMode, RuntimeCodeExecutionMode, RuntimeCodeFragmentStatus, RuntimeErrorBehavior, RuntimeState, ILanguageRuntimeMessageResult, ILanguageRuntimeMessageError, RuntimeOnlineState } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import * as extHostProtocol from './extHost.positron.protocol.js';
import { Emitter } from '../../../../base/common/event.js';
import { DisposableStore, IDisposable } from '../../../../base/common/lifecycle.js';
import { Disposable, LanguageRuntimeMessageType } from '../extHostTypes.js';
import { RuntimeClientState, RuntimeClientType, RuntimeExitReason } from './extHostTypes.positron.js';
import { ExtHostRuntimeClientInstance } from './extHostClientInstance.js';
import { ExtensionIdentifier, IExtensionDescription } from '../../../../platform/extensions/common/extensions.js';
import { URI } from '../../../../base/common/uri.js';
import { DeferredPromise, retry } from '../../../../base/common/async.js';
import { IRuntimeSessionMetadata } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { SerializableObjectWithBuffers } from '../../../services/extensions/common/proxyIdentifier.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { ILanguageRuntimeCodeExecutedEvent } from '../../../services/positronConsole/browser/interfaces/positronConsoleService.js';

/**
 * Interface for code execution observers
 */
interface IExecutionObserver {
	/** A cancellation token for interrupting execution */
	token?: CancellationToken;

	/** Called when execution starts */
	onStarted?: () => void;

	/** Called when text output is produced */
	onOutput?: (message: string) => void;

	/** Called when error output is produced */
	onError?: (message: string) => void;

	/** Called when a plot is generated */
	onPlot?: (plotData: string) => void;

	/** Called when data (like a dataframe) is produced */
	onData?: (data: any) => void;

	/** Called on successful completion with a result */
	onCompleted?: (result: any) => void;

	/** Called when execution fails with an error */
	onFailed?: (error: Error) => void;

	/** Called when execution finishes (after success or failure) */
	onFinished?: () => void;
}

/**
 * Wraps an IExecutionObserver and provides a promise that resolves when the
 * execution is completed. This allows us to track the state of the
 * execution and notify when it is completed.
 */
class ExecutionObserver implements IDisposable {

	/** The promise that resolves when the computation completes */
	public readonly promise: DeferredPromise<Record<string, any>>;

	/** Store of disposables to be cleaned up */
	public readonly store: DisposableStore = new DisposableStore();

	/** The current state of the computation */
	public state: 'pending' | 'running' | 'completed';

	/**
	 * The session ID in which the computation is running. This is not always
	 * known when creating the observer since the it is possible we need to
	 * create a new session to fulfill the request.
	 */
	public sessionId: string | undefined;

	constructor(public readonly observer: IExecutionObserver | undefined) {
		this.state = 'pending';
		this.promise = new DeferredPromise<Record<string, any>>();
	}

	onOutputMessage(message: ILanguageRuntimeMessageOutput) {
		if (this.observer && message.data) {
			const imageMimeTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml'];
			for (const mimeType of imageMimeTypes) {
				if (message.data[mimeType] && this.observer.onPlot) {
					this.observer.onPlot(message.data[mimeType]);
				}
			}
			if (message.data['text/plain'] && this.observer.onOutput) {
				this.observer.onOutput(message.data['text/plain']);
			}
		}
	}

	onStateMessage(message: ILanguageRuntimeMessageState) {
		// When entering the busy state, consider code execution to have
		// started
		if (message.state === RuntimeOnlineState.Busy) {
			this.onStarted();
		}

		// When entering the idle state, consider code execution to have
		// finished
		if (message.state === RuntimeOnlineState.Idle) {
			this.onFinished();
		}
	}

	onStreamMessage(message: ILanguageRuntimeMessageStream) {
		if (this.observer) {
			if (message.name === 'stdout' && this.observer.onOutput) {
				this.observer.onOutput(message.text);
			} else if (message.name === 'stderr' && this.observer.onError) {
				this.observer.onError(message.text);
			}
		}
	}

	onStarted() {
		this.state = 'running';
		if (this.observer?.onStarted) {
			this.observer.onStarted();
		}
	}

	onFinished() {
		this.state = 'completed';
		if (this.observer?.onFinished) {
			this.observer.onFinished();
		}
		// Ensure we're settled if we aren't yet
		if (!this.promise.isSettled) {
			this.promise.complete({});
		}
	}

	onErrorMessage(message: ILanguageRuntimeMessageError) {
		const err: Error = {
			message: message.message,
			name: message.name,
			stack: message.traceback?.join('\n'),
		};
		this.onFailed(err);
	}

	onFailed(error: Error) {
		this.state = 'completed';
		if (this.observer?.onFailed) {
			this.observer.onFailed(error);
		}
		this.promise.error(error);
	}

	onCompleted(result: Record<string, any>) {
		this.state = 'completed';
		if (this.observer?.onCompleted) {
			this.observer.onCompleted(result);
		}
		this.promise.complete(result);
	}

	dispose(): void {
		this.store.dispose();
	}
}

/**
 * A language runtime manager and metadata about the extension that registered it.
 */
interface LanguageRuntimeManager {
	/** The language for which the manager provides runtimes */
	languageId: string;

	/** The manager itself */
	manager: positron.LanguageRuntimeManager;

	/** The extension that supplied the manager */
	extension: IExtensionDescription;
}

export class ExtHostLanguageRuntime implements extHostProtocol.ExtHostLanguageRuntimeShape {

	private readonly _proxy: extHostProtocol.MainThreadLanguageRuntimeShape;

	private readonly _registeredRuntimes = new Array<positron.LanguageRuntimeMetadata>();

	private readonly _runtimeManagersByRuntimeId = new Map<string, LanguageRuntimeManager>();

	private readonly _runtimeManagers = new Array<LanguageRuntimeManager>();

	private readonly _pendingRuntimeManagers = new Map<string, DeferredPromise<LanguageRuntimeManager>>();

	// A list of active sessions.
	private readonly _runtimeSessions = new Array<positron.LanguageRuntimeSession>();

	private readonly _clientInstances = new Array<ExtHostRuntimeClientInstance>();

	private readonly _clientHandlers = new Array<positron.RuntimeClientHandler>();

	private readonly _registeredClientIds = new Set<string>();

	/**
	 * Lamport clocks, used for event ordering. Each runtime has its own clock since
	 * events are only ordered within a runtime.
	 */
	private _eventClocks = new Array<number>();

	/**
	 * Indicates whether language runtime discovery is complete.
	 */
	private _runtimeDiscoveryComplete = false;

	// The event emitter for the onDidRegisterRuntime event.
	private readonly _onDidRegisterRuntimeEmitter = new Emitter<positron.LanguageRuntimeMetadata>;

	// The event that fires when a runtime is registered.
	public onDidRegisterRuntime = this._onDidRegisterRuntimeEmitter.event;

	// The event emitter for the onDidChangeForegroundSession event.
	private readonly _onDidChangeForegroundSessionEmitter = new Emitter<string | undefined>;

	// The event that fires when the foreground session changes.
	public onDidChangeForegroundSession = this._onDidChangeForegroundSessionEmitter.event;

	// The event emitter for the onDidExecuteCode event.
	private readonly _onDidExecuteCodeEmitter = new Emitter<positron.CodeExecutionEvent>();

	// The event that fires when code is executed.
	public onDidExecuteCode = this._onDidExecuteCodeEmitter.event;

	// Map to track execution observers by execution ID
	private _executionObservers = new Map<string, ExecutionObserver>();

	constructor(
		mainContext: extHostProtocol.IMainPositronContext,
		private readonly _logService: ILogService,
	) {
		// Trigger creation of the proxy
		this._proxy = mainContext.getProxy(extHostProtocol.MainPositronContext.MainThreadLanguageRuntime);
	}

	/**
	 * Creates a language runtime session.
	 *
	 * @param runtimeMetadata The metadata for the language runtime.
	 * @param sessionMetadata The metadata for the session.
	 *
	 * @returns A promise that resolves with a handle to the runtime session.
	 */
	async $createLanguageRuntimeSession(
		runtimeMetadata: ILanguageRuntimeMetadata,
		sessionMetadata: IRuntimeSessionMetadata): Promise<extHostProtocol.RuntimeInitialState> {
		// Look up the session manager responsible for restoring this session
		const sessionManager = await this.runtimeManagerForRuntime(runtimeMetadata, true);

		if (sessionMetadata.notebookUri) {
			// Sometimes the full URI doesn't make it across the serialization boundary.
			// By reviving the URI here we make sure we're operating with a full URI
			// rather than a serialized one that may be missing parameters.
			sessionMetadata = {
				...sessionMetadata,
				notebookUri: URI.revive(sessionMetadata.notebookUri)
			};
		}
		if (sessionManager) {
			const session =
				await sessionManager.manager.createSession(runtimeMetadata, sessionMetadata);
			const handle = this.attachToSession(session);
			const initalState = {
				handle,
				dynState: session.dynState
			};
			return initalState;
		} else {
			throw new Error(
				`No session manager found for language ID '${runtimeMetadata.languageId}'.`);
		}
	}

	/**
	 * Indicates whether the extension host is the host for a given language runtime.
	 *
	 * @param runtimeMetadata The metadata for the language runtime to test.
	 * @returns The result of the test.
	 */
	async $isHostForLanguageRuntime(runtimeMetadata: ILanguageRuntimeMetadata): Promise<boolean> {
		// Shortcut: if there aren't any managers, then we can't be the host
		if (this._runtimeManagers.length === 0) {
			return false;
		}
		const sessionManager =
			await this.runtimeManagerForRuntime(runtimeMetadata, false /* don't wait */);
		return !!sessionManager;
	}

	/**
	 * Validates an ILanguageRuntimeMetadata object; typically used to validate
	 * stored metadata prior to starting a runtime.
	 *
	 * @param metadata The metadata to validate
	 * @returns An updated metadata object
	 */
	async $validateLanguageRuntimeMetadata(metadata: ILanguageRuntimeMetadata):
		Promise<ILanguageRuntimeMetadata> {
		// Find the runtime manager that should be used for this metadata
		const m = await this.runtimeManagerForRuntime(metadata, true);
		if (m) {
			if (m.manager.validateMetadata) {
				// The runtime manager has a validateMetadata function; use it to
				// validate the metadata
				const result = await m.manager.validateMetadata(metadata);
				return {
					...result,
					extensionId: metadata.extensionId
				};
			} else {
				// The runtime manager doesn't have a validateMetadata function;
				// this is OK and just means that it doesn't know how to perform
				// validation. Return the metadata as-is.
				return metadata;
			}
		} else {
			// We can't validate this metadata, and probably shouldn't use it.
			throw new Error(
				`No manager available for language ID '${metadata.languageId}' ` +
				`(expected from extension ${metadata.extensionId.value})`);
		}
	}

	/**
	 * Validates a language runtime session.
	 *
	 * @param metadata The metadata for the language runtime.
	 * @param sessionId The session ID to validate.
	 */
	async $validateLanguageRuntimeSession(metadata: ILanguageRuntimeMetadata,
		sessionId: string): Promise<boolean> {

		// Find the runtime manager that should be used for this session
		const m = await this.runtimeManagerForRuntime(metadata, true);
		if (m) {
			if (m.manager.validateSession) {
				// The runtime manager has a validateSession function; use it to
				// validate the session
				const result = await m.manager.validateSession(sessionId);
				return result;
			} else {
				// Just consider the session to be invalid
				return false;
			}
		} else {
			// We can't validate this session, and probably shouldn't use it.
			throw new Error(
				`No manager available for language ID '${metadata.languageId}' ` +
				`(expected from extension ${metadata.extensionId.value})`);
		}
	}

	/**
	 * Restores a language runtime session.
	 *
	 * @param runtimeMetadata The metadata for the language runtime.
	 * @param sessionMetadata The metadata for the session.
	 *
	 * @returns A promise that resolves with a handle to the runtime session.
	 */
	async $restoreLanguageRuntimeSession(
		runtimeMetadata: ILanguageRuntimeMetadata,
		sessionMetadata: IRuntimeSessionMetadata): Promise<extHostProtocol.RuntimeInitialState> {
		// Look up the session manager responsible for restoring this session
		console.debug(`[Reconnect ${sessionMetadata.sessionId}]: Await runtime manager for runtime ${runtimeMetadata.extensionId.value}...`);
		const sessionManager = await this.runtimeManagerForRuntime(runtimeMetadata, true);
		if (sessionManager) {
			if (sessionManager.manager.restoreSession) {
				// Attempt to restore the session. There are a lot of reasons
				// this could fail, chief among them that the session isn't
				// around any more.
				console.debug(`[Reconnect ${sessionMetadata.sessionId}]: Await restore session...`);
				const session =
					await sessionManager.manager.restoreSession(runtimeMetadata, sessionMetadata);
				const handle = this.attachToSession(session);
				const initalState = {
					handle,
					dynState: session.dynState
				};
				return initalState;
			} else {
				// Session restoration is optional; if the session manager
				// doesn't support it, then throw an error
				throw new Error(
					`Session manager for session ID '${sessionMetadata.sessionId}'. ` +
					`does not support session restoration.`);
			}
		} else {
			throw new Error(
				`No session manager found for language ID '${runtimeMetadata.languageId}'.`);
		}
	}

	/**
	 * Utility function to look up the manager for a given runtime.
	 *
	 * If it can't find the runtime manager, then it will (optionally) wait
	 * until the runtime manager is registered (up to 10 seconds). If the
	 * runtime manager is not registered within that time, then it will reject
	 * the promise.
	 *
	 * @param metadata The metadata for the runtime
	 * @param wait Whether to wait for the runtime manager to be registered if
	 *  it is not already registered.
	 *
	 *
	 * @returns A promise that resolves with the runtime manager for the
	 * runtime.
	 */
	private async runtimeManagerForRuntime(metadata: ILanguageRuntimeMetadata, wait: boolean): Promise<LanguageRuntimeManager | undefined> {
		// Do we already have a manager for this runtime? This happens when we
		// look up a runtime manager for a runtime that has already been
		// registered.
		const managerById = this._runtimeManagersByRuntimeId.get(metadata.runtimeId);
		if (managerById) {
			return managerById;
		}

		// Is the manager already known? This happens when we look up a runtime
		// manager for a runtime that hasn't been registered, but is supplied by
		// an extension that has registered a manager.
		const managerByExt = this._runtimeManagers.find(manager =>
			manager.extension.id === metadata.extensionId.value);
		if (managerByExt) {
			return managerByExt;
		}


		// If we don't have a manager for this runtime, and we're not waiting
		// for one, then return undefined.
		if (!wait) {
			return undefined;
		}

		// Do we already have a pending promise for this extension? If so,
		// return it.
		const pending = this._pendingRuntimeManagers.get(
			ExtensionIdentifier.toKey(metadata.extensionId));
		if (pending) {
			return pending.p;
		}

		// We don't have a manager for this runtime; wait for one.
		const deferred = new DeferredPromise<LanguageRuntimeManager>();
		this._pendingRuntimeManagers.set(ExtensionIdentifier.toKey(metadata.extensionId), deferred);

		// Don't wait forever; if the deferred promise doesn't settle within 10
		// seconds, then reject the promise.
		setTimeout(() => {
			if (!deferred.isSettled) {
				deferred.error(new Error(
					`Timed out after 10 seconds waiting for runtime manager for runtime ` +
					`'${metadata.runtimeName}' (${metadata.runtimeId}) to be registered.`));
			}
		}, 10000);

		return deferred.p;
	}

	/**
	 * Attach to a language runtime session.
	 *
	 * @param session The language runtime session to attach to
	 *
	 * @returns The handle to the session
	 */
	private attachToSession(session: positron.LanguageRuntimeSession): number {
		// Wire event handlers for state changes and messages
		session.onDidChangeRuntimeState(state => {
			const tick = this._eventClocks[handle] = this._eventClocks[handle] + 1;
			this._proxy.$emitLanguageRuntimeState(handle, tick, state);

			// When the session exits, make sure to shut down any of its
			// remaining execution observers cleanly so they aren't left
			// hanging.
			if (state === RuntimeState.Exited) {
				this._executionObservers.forEach((observer, id) => {
					if (observer.sessionId === session.metadata.sessionId) {
						// The observer is associated with this session, so we
						// need to clean it up. Reject its promise if it hasn't
						// already been settled.
						if (!observer.promise.isSettled) {
							observer.onFailed({
								message: 'The session exited unexpectedly.',
								name: 'Interrupted',
							});
						}
						observer.dispose();
						this._executionObservers.delete(id);
					}
				});
			}
		});

		session.onDidReceiveRuntimeMessage(message => {
			const tick = this._eventClocks[handle] = this._eventClocks[handle] + 1;
			// Amend the message with the event clock for ordering
			const runtimeMessage: ILanguageRuntimeMessage = {
				event_clock: tick,
				...message,
				// Wrap buffers in VSBuffer so that they can be sent to the main thread
				buffers: message.buffers?.map(buffer => VSBuffer.wrap(buffer)),
			};

			// First check if this message relates to an execution with an observer
			if (message.parent_id && this._executionObservers.has(message.parent_id)) {
				// Get the observer for this execution
				const observer = this._executionObservers.get(message.parent_id);

				// Handle the message based on its type
				if (observer) {
					this.handleObserverMessage(runtimeMessage, observer);
				}
			}

			// Dispatch the message to the appropriate handler
			switch (message.type) {
				// Handle comm messages separately
				case LanguageRuntimeMessageType.CommOpen:
					this.handleCommOpen(handle, runtimeMessage as ILanguageRuntimeMessageCommOpen);
					break;

				case LanguageRuntimeMessageType.CommData:
					this.handleCommData(handle, runtimeMessage as ILanguageRuntimeMessageCommData);
					break;

				case LanguageRuntimeMessageType.CommClosed:
					this.handleCommClosed(handle, runtimeMessage as ILanguageRuntimeMessageCommClosed);
					break;

				// Pass everything else to the main thread
				default:
					this._proxy.$emitLanguageRuntimeMessage(handle, false, new SerializableObjectWithBuffers(runtimeMessage));
					break;
			}
		});

		// Hook up the session end (exit) handler
		session.onDidEndSession(exit => {
			// Notify the main thread that the session has ended
			this._proxy.$emitLanguageRuntimeExit(handle, exit);

			// If the session isn't exiting in order to restart, then we need
			// to clean up its resources.
			if (exit.reason !== RuntimeExitReason.Restart) {
				session.dispose();
			}

			// Note that we don't remove the session from the list of sessions;
			// that would invalidate the handles of all subsequent sessions
			// since we store them in an array. The session remains in an inert
			// state.
		});

		// Register the runtime
		const handle = this._runtimeSessions.length;
		this._runtimeSessions.push(session);

		this._eventClocks.push(0);

		return handle;
	}

	async $interruptLanguageRuntime(handle: number): Promise<void> {
		if (handle >= this._runtimeSessions.length) {
			throw new Error(`Cannot interrupt runtime: session handle '${handle}' not found or no longer valid.`);
		}
		const session = this._runtimeSessions[handle];
		try {
			return session.interrupt();
		} finally {
			// Whether or not the interrupt was successful, ensure that
			// execution observers associated with this session are settled, so
			// that interrupting the session is always successful from the
			// perspective of the observer even if the underlying session fails
			// to interrupt.
			this._executionObservers.forEach((observer, id) => {
				if (observer.sessionId === session.metadata.sessionId) {
					// The observer is associated with this session, so we
					// need to clean it up. Reject its promise if it hasn't
					// already been settled.
					if (!observer.promise.isSettled) {
						observer.onFailed({
							message: 'The user interrupted the code execution.',
							name: 'Interrupted',
						});
					}
					observer.dispose();
					this._executionObservers.delete(id);
				}
			});
		}
	}

	async $shutdownLanguageRuntime(handle: number, exitReason: positron.RuntimeExitReason): Promise<void> {
		if (handle >= this._runtimeSessions.length) {
			throw new Error(`Cannot shut down runtime: session handle '${handle}' not found or no longer valid.`);
		}
		return this._runtimeSessions[handle].shutdown(exitReason);
	}

	async $forceQuitLanguageRuntime(handle: number): Promise<void> {
		if (handle >= this._runtimeSessions.length) {
			throw new Error(`Cannot force quit runtime: session handle '${handle}' not found or no longer valid.`);
		}
		return this._runtimeSessions[handle].forceQuit();
	}

	async $restartSession(handle: number, workingDirectory?: string): Promise<void> {
		if (handle >= this._runtimeSessions.length) {
			throw new Error(`Cannot restart runtime: session handle '${handle}' not found or no longer valid.`);
		}
		return this._runtimeSessions[handle].restart(workingDirectory);
	}

	async $startLanguageRuntime(handle: number): Promise<positron.LanguageRuntimeInfo> {
		if (handle >= this._runtimeSessions.length) {
			throw new Error(`Cannot restart runtime: session handle '${handle}' not found or no longer valid.`);
		}
		return this._runtimeSessions[handle].start();
	}

	$showOutputLanguageRuntime(handle: number, channel?: positron.LanguageRuntimeSessionChannel): void {
		if (handle >= this._runtimeSessions.length) {
			throw new Error(`Cannot show output for runtime: language runtime session handle '${handle}' not found or no longer valid.`);
		}
		if (!this._runtimeSessions[handle].showOutput) {
			throw new Error(`Cannot show output for runtime: language runtime session handle '${handle}' does not implement logging.`);
		}
		return this._runtimeSessions[handle].showOutput(channel);
	}

	async $listOutputChannelsLanguageRuntime(handle: number): Promise<positron.LanguageRuntimeSessionChannel[]> {
		if (handle >= this._runtimeSessions.length) {
			throw new Error(`Cannot list output channels for runtime: language runtime session handle '${handle}' not found or no longer valid.`);
		}
		if (!this._runtimeSessions[handle].listOutputChannels) {
			throw new Error(`Cannot list output channels for runtime: language runtime session handle '${handle}'`);
		}
		return this._runtimeSessions[handle].listOutputChannels();
	}

	$showProfileLanguageRuntime(handle: number): Thenable<void> {
		if (handle >= this._runtimeSessions.length) {
			throw new Error(`Cannot show profile for runtime: language runtime session handle '${handle}' not found or no longer valid.`);
		}
		if (!this._runtimeSessions[handle].showProfile) {
			throw new Error(`Cannot show profile for runtime: language runtime session handle '${handle}' does not implement profiling.`);
		}
		return this._runtimeSessions[handle].showProfile!();
	}


	$openResource(handle: number, resource: URI | string): Promise<boolean> {
		if (handle >= this._runtimeSessions.length) {
			throw new Error(`Cannot open resource: session handle '${handle}' not found or no longer valid.`);
		}
		if (!this._runtimeSessions[handle].openResource) {
			return Promise.resolve(false);
		}
		return Promise.resolve(this._runtimeSessions[handle].openResource!(resource));
	}

	$executeCode(handle: number, code: string, id: string, mode: RuntimeCodeExecutionMode, errorBehavior: RuntimeErrorBehavior): void {
		if (handle >= this._runtimeSessions.length) {
			throw new Error(`Cannot execute code: session handle '${handle}' not found or no longer valid.`);
		}
		this._runtimeSessions[handle].execute(code, id, mode, errorBehavior);
	}

	$isCodeFragmentComplete(handle: number, code: string): Promise<RuntimeCodeFragmentStatus> {
		if (handle >= this._runtimeSessions.length) {
			throw new Error(`Cannot test code completeness: session handle '${handle}' not found or no longer valid.`);
		}
		return Promise.resolve(this._runtimeSessions[handle].isCodeFragmentComplete(code));
	}

	$createClient(handle: number, id: string, type: RuntimeClientType, params: any, metadata?: any): Promise<void> {
		if (handle >= this._runtimeSessions.length) {
			throw new Error(`Cannot create '${type}' client: session handle '${handle}' not found or no longer valid.`);
		}
		return Promise.resolve(this._runtimeSessions[handle].createClient(id, type, params, metadata));
	}

	$listClients(handle: number, type?: RuntimeClientType): Promise<Record<string, string>> {
		if (handle >= this._runtimeSessions.length) {
			throw new Error(`Cannot list clients: session handle '${handle}' not found or no longer valid.`);
		}
		return Promise.resolve(this._runtimeSessions[handle].listClients(type));
	}

	$removeClient(handle: number, id: string): void {
		if (handle >= this._runtimeSessions.length) {
			throw new Error(`Cannot remove client: session handle '${handle}' not found or no longer valid.`);
		}
		this._runtimeSessions[handle].removeClient(id);
	}

	$sendClientMessage(handle: number, client_id: string, message_id: string, message: any): void {
		if (handle >= this._runtimeSessions.length) {
			throw new Error(`Cannot send message to client: session handle '${handle}' not found or no longer valid.`);
		}
		this._runtimeSessions[handle].sendClientMessage(client_id, message_id, message);
	}

	$replyToPrompt(handle: number, id: string, response: string): void {
		if (handle >= this._runtimeSessions.length) {
			throw new Error(`Cannot reply to prompt: session handle '${handle}' not found or no longer valid.`);
		}
		this._runtimeSessions[handle].replyToPrompt(id, response);
	}

	$setWorkingDirectory(handle: number, dir: string): Promise<void> {
		if (handle >= this._runtimeSessions.length) {
			throw new Error(`Cannot set working directory: session handle '${handle}' not found or no longer valid.`);
		}
		return new Promise((resolve, reject) => {
			this._runtimeSessions[handle].setWorkingDirectory(dir).then(
				() => {
					resolve();
				},
				(err) => {
					reject(err);
				});
		});
	}

	public async $recommendWorkspaceRuntimes(disabledLanguageIds: string[]): Promise<ILanguageRuntimeMetadata[]> {
		// Get the recommended runtimes from each provider
		const metadata = await Promise.all(
			this._runtimeManagers.filter(m => {
				// Remove disabled languages from the list of runtime managers
				return !disabledLanguageIds.includes(m.languageId);
			}
			).map(async m => {
				// Get the recommended runtime from the provider, if any
				const recommended = await m.manager.recommendedWorkspaceRuntime();
				if (recommended) {
					return {
						extensionId: m.extension.identifier,
						...recommended
					};
				}
				return undefined;
			})
		);

		// Return all the metadata from the providers
		return metadata.filter(metadata => metadata !== undefined) as ILanguageRuntimeMetadata[];
	}

	/**
	 * Discovers language runtimes and registers them with the main thread.
	 *
	 * @param disabledLanguageIds The set of language IDs to exclude from discovery
	 */
	public async $discoverLanguageRuntimes(disabledLanguageIds: string[]): Promise<void> {
		// Extract all the runtime discoverers from the runtime managers
		let start = 0;
		let end = this._runtimeManagers.length;

		// Discover runtimes from each provider in parallel
		while (start !== end) {
			// Extract the section of the providers list we're working on and discover
			// runtimes from it
			const managers = this._runtimeManagers.slice(start, end);
			try {
				await this.discoverLanguageRuntimes(managers, disabledLanguageIds);
			} catch (err) {
				// Log and continue if errors occur during registration; this is
				// a safeguard to ensure we always signal the main thread when
				// discovery is complete (below)
				console.error(err);
			}

			// Typically the loop ends after the first pass, but if new
			// providers were added while we were discovering runtimes, then we
			// need to go back into the body of the loop to discover those
			// runtimes as well.
			start = end;
			end = this._runtimeManagers.length;
		}

		// Notify the main thread that discovery is complete
		this._runtimeDiscoveryComplete = true;
		this._proxy.$completeLanguageRuntimeDiscovery();
	}

	/**
	 * Notifies the extension host that the foreground session has changed.
	 * This is forwarding the event from the main thread to the extension host.
	 *
	 * @param sessionId The ID of the new foreground session
	 */
	@debounce(1000)
	public async $notifyForegroundSessionChanged(sessionId: string | undefined): Promise<void> {
		const session = this._runtimeSessions.find(session => session.metadata.sessionId === sessionId);
		if (!session && sessionId) {
			throw new Error(`Session ID '${sessionId}' was marked as the foreground session, but is not known to the extension host.`);
		}
		this._onDidChangeForegroundSessionEmitter.fire(sessionId);
	}

	/**
	 * Notification from the main thread that code has been executed.
	 *
	 * @param event The event containing the code execution details
	 */
	public async $notifyCodeExecuted(event: ILanguageRuntimeCodeExecutedEvent): Promise<void> {
		// Derive the code attribution object
		const attribution: positron.CodeAttribution = {
			metadata: event.attribution.metadata,
			source: event.attribution.source as unknown as positron.CodeAttributionSource,
		};

		// Create the event object
		const evt: positron.CodeExecutionEvent = {
			languageId: event.languageId,
			code: event.code,
			attribution,
			runtimeName: event.runtimeName,
		};

		this._onDidExecuteCodeEmitter.fire(evt);
	}

	/**
	 * Discovers language runtimes in parallel and registers each one with the main thread.
	 *
	 * @param discoverers The set of discoverers to discover runtimes from
	 * @param disabledLanguageIds The set of language IDs to exclude from discovery
	 */
	private async discoverLanguageRuntimes(managers: Array<LanguageRuntimeManager>, disabledLanguageIds: string[]): Promise<void> {

		// Utility promise
		const never: Promise<never> = new Promise(() => { });

		// Utility interface to keep track of the discoverers and their extensions
		interface Discoverer {
			extension: IExtensionDescription;
			manager: positron.LanguageRuntimeManager;
			discoverer: AsyncGenerator<positron.LanguageRuntimeMetadata, void, unknown>;
		}

		// Invoke all the discovery functions to return an async generator for each
		const discoverers: Array<Discoverer> = managers.map(manager => ({
			extension: manager.extension,
			manager: manager.manager,
			languageId: manager.languageId,
			discoverer: manager.manager.discoverAllRuntimes()
		})).filter(discoverer =>
			// Do not discover runtimes for disabled languages
			!disabledLanguageIds.includes(discoverer.languageId)
		);

		// The number of discoverers we're waiting on (initially all
		// discoverers)
		let count = discoverers.length;

		// Early exit if there are no discoverers
		if (count === 0) {
			return;
		}

		// Utility function to get the next runtime from a provider and amend an
		// index. If the provider throws an error attempting to get the next
		// provider, then the error is logged and the function signals that the
		// provider is done.
		const getNext =
			async (asyncGen: Discoverer, index: number) => {
				try {
					const result = await asyncGen.discoverer.next();
					return ({
						index,
						extension: asyncGen.extension,
						manager: asyncGen.manager,
						result
					});
				} catch (err) {
					console.error(`Language runtime provider threw an error during registration: ` +
						`${err}`);
					return {
						index,
						extension: asyncGen.extension,
						manager: asyncGen.manager,
						result: { value: undefined, done: true }
					};
				}
			};

		// Array mapping each provider to a promise for its next runtime
		const nextPromises = discoverers.map(getNext);

		try {
			while (count) {
				// Wait for the next runtime to be discovered from any provider
				const { index, extension, manager, result } = await Promise.race(nextPromises);
				if (result.done) {
					// If the provider is done supplying runtimes, remove it
					// from the list of discoverers we're waiting on
					nextPromises[index] = never;
					count--;
				} else if (result.value !== undefined) {
					// Otherwise, move on to the next runtime from the provider
					// and register the runtime it returned
					nextPromises[index] = getNext(discoverers[index], index);
					try {
						this.registerLanguageRuntime(extension, manager, result.value);
					} catch (err) {
						console.error(`Error registering language runtime ` +
							`${result.value.runtimeName}: ${err}`);
					}
				}
			}
		} catch (err) {
			console.error(`Halting language runtime registration: ${err}`);
		} finally {
			// Clean up any remaining promises
			for (const [index, iterator] of discoverers.entries()) {
				if (nextPromises[index] !== never && iterator.discoverer.return !== null) {
					void iterator.discoverer.return(undefined);
				}
			}
		}
	}

	public registerClientHandler(handler: positron.RuntimeClientHandler): IDisposable {
		this._clientHandlers.push(handler);
		return new Disposable(() => {
			const index = this._clientHandlers.indexOf(handler);
			if (index >= 0) {
				this._clientHandlers.splice(index, 1);
			}
		});
	}

	public registerClientInstance(clientInstanceId: string): IDisposable {
		this._registeredClientIds.add(clientInstanceId);
		return new Disposable(() => {
			this._registeredClientIds.delete(clientInstanceId);
		});
	}

	public getRegisteredRuntimes(): Promise<positron.LanguageRuntimeMetadata[]> {
		return Promise.resolve(this._registeredRuntimes);
	}

	public async getPreferredRuntime(languageId: string): Promise<positron.LanguageRuntimeMetadata> {
		const metadata = await this._proxy.$getPreferredRuntime(languageId);

		// If discovery is in progress, a runtime may exist on the main thread but not
		// the extension host, so retry a bunch of times. Retrying is more likely to return
		// faster than waiting for the entire discovery phase to complete since runtimes are
		// discovered concurrently across languages.
		return retry(async () => {
			const runtime = this._registeredRuntimes.find(runtime => runtime.runtimeId === metadata.runtimeId);
			if (!runtime) {
				this._logService.warn(`Could not find runtime ${metadata.runtimeId} on extension host. Waiting 2 seconds and retrying.`);
				throw new Error(`Runtime exists on main thread but not extension host: ${metadata.runtimeId}`);
			}
			return runtime;
		}, 2000, 5);
	}

	public async getActiveSessions(): Promise<positron.LanguageRuntimeSession[]> {
		const sessionMetadatas = await this._proxy.$getActiveSessions();
		const sessions: positron.LanguageRuntimeSession[] = [];
		for (const sessionMetadata of sessionMetadatas) {
			const session = this._runtimeSessions.find(session => session.metadata.sessionId === sessionMetadata.sessionId);
			if (!session) {
				throw new Error(`Session ID '${sessionMetadata.sessionId}' was returned as an active session, but is not known to the extension host.`);
			}
			sessions.push(session);
		}
		return sessions;
	}

	public async getForegroundSession(): Promise<positron.LanguageRuntimeSession | undefined> {
		const sessionId = await this._proxy.$getForegroundSession();
		if (!sessionId) {
			return;
		}
		const session = this._runtimeSessions.find(session => session.metadata.sessionId === sessionId);
		if (!session) {
			throw new Error(`Session ID '${sessionId}' was marked as the foreground session, but is not known to the extension host.`);
		}
		return session;
	}

	public async getNotebookSession(notebookUri: URI): Promise<positron.LanguageRuntimeSession | undefined> {
		const sessionId = await this._proxy.$getNotebookSession(notebookUri);
		if (!sessionId) {
			return;
		}
		const session = this._runtimeSessions.find(session => session.metadata.sessionId === sessionId);
		if (!session) {
			throw new Error(`Session ID '${sessionId}' exists for notebook '${notebookUri.toString()}', but is not known to the extension host.`);
		}
		return session;
	}

	/**
	 * Registers a new language runtime manager with the extension host.
	 *
	 * @param extension The extension that is registering the manager
	 * @param languageId The language ID for which the manager provides runtimes
	 * @param manager The manager to register
	 * @returns A disposable that unregisters the manager when disposed
	 */
	public registerLanguageRuntimeManager(
		extension: IExtensionDescription,
		languageId: string,
		manager: positron.LanguageRuntimeManager): IDisposable {

		const disposables = new DisposableStore();

		// If we were waiting for this runtime manager to be registered, then
		// resolve the promise now.
		const pending = this._pendingRuntimeManagers.get(ExtensionIdentifier.toKey(extension.identifier));
		if (pending) {
			pending.complete({ manager, languageId, extension });
			this._pendingRuntimeManagers.delete(ExtensionIdentifier.toKey(extension.identifier));
		}

		if (this._runtimeDiscoveryComplete) {
			// We missed the discovery phase. Invoke the provider's async
			// generator and register each runtime it returns right away.
			//
			// Note that if we don't miss the discovery phase, then the
			// provider's async generator will be invoked as part of the
			// discovery process, and we don't need to do anything here.
			void (async () => {
				const discoverer = manager.discoverAllRuntimes();
				for await (const runtime of discoverer) {
					disposables.add(this.registerLanguageRuntime(extension, manager, runtime));
				}
			})();
		}

		// Attach an event handler to the onDidDiscoverRuntime event, if
		// present. This event notifies us when a new runtime is discovered
		// outside the discovery phase.
		if (manager.onDidDiscoverRuntime) {
			disposables.add(manager.onDidDiscoverRuntime(runtime => {
				this.registerLanguageRuntime(extension, manager, runtime);
			}));
		}

		this._runtimeManagers.push({ manager, languageId, extension });

		return new Disposable(() => {
			// Clean up disposables
			disposables.dispose();

			// Remove the manager from the list of registered managers
			const index = this._runtimeManagers.findIndex(m => m.manager === manager);
			if (index >= 0) {
				this._runtimeManagers.splice(index, 1);
			}
		});
	}

	public registerLanguageRuntime(
		extension: IExtensionDescription,
		manager: positron.LanguageRuntimeManager,
		runtime: positron.LanguageRuntimeMetadata): IDisposable {

		// Create a handle and register the runtime with the main thread
		const handle = this._registeredRuntimes.length;

		// Register the runtime with the main thread
		this._proxy.$registerLanguageRuntime(handle, {
			extensionId: extension.identifier,
			...runtime
		});
		this._onDidRegisterRuntimeEmitter.fire(runtime);

		// Add this runtime to the set of registered runtimes
		this._registeredRuntimes.push(runtime);

		// Save the manager associated with this runtime, too; we'll need to use
		// it to create a runtime session later
		this._runtimeManagersByRuntimeId.set(runtime.runtimeId, { manager, languageId: runtime.languageId, extension });

		return new Disposable(() => {
			this._proxy.$unregisterLanguageRuntime(handle);
		});
	}

	public executeCode(
		languageId: string,
		code: string,
		extensionId: string,
		focus: boolean,
		allowIncomplete?: boolean,
		mode?: RuntimeCodeExecutionMode,
		errorBehavior?: RuntimeErrorBehavior,
		observer?: IExecutionObserver): Promise<Record<string, any>> {

		// Create a UUID and an observer for this execution request
		const executionId = generateUuid();
		const executionObserver = new ExecutionObserver(observer);
		this._executionObservers.set(executionId, executionObserver);

		// Begin the code execution. This returns a promise that resolves to the
		// session ID of the session assigned (or created) to run the code.
		this._proxy.$executeCode(
			languageId, code, extensionId, focus, allowIncomplete, mode, errorBehavior, executionId).then(
				(sessionId) => {
					// Bind the session ID to the observer so we can use it later
					executionObserver.sessionId = sessionId;

					// If a cancellation token was provided, then add a cancellation
					// request handler so we can interrupt the session if requested
					if (!observer?.token) {
						return;
					}
					const token = observer.token;
					executionObserver.store.add(
						token.onCancellationRequested(async () => {
							// We can't interrupt the code if it hasn't started yet.
							//
							// CONSIDER: We could handle this by reaching
							// back into the main thread and asking it to
							// cancel the execution request that has not yet
							// been dispatched
							if (executionObserver.state === 'pending') {
								this._logService.warn(
									`Cannot interrupt execution of ${code}: ` +
									`it has not yet started.`);
							}

							// If the code is running, interrupt the session
							if (executionObserver.state === 'running') {
								await this.interruptSession(sessionId);
							}
						}));
				}).catch((err) => {
					// Propagate the error to the observer
					executionObserver.promise.error(err);
				});

		return executionObserver.promise.p;
	}

	/**
	 * Selects and starts a language runtime.
	 *
	 * @param runtimeId The runtime ID to select and start.
	 */
	public selectLanguageRuntime(runtimeId: string): Promise<void> {
		return this._proxy.$selectLanguageRuntime(runtimeId);
	}

	/**
	 * Start a new session for a runtime previously registered with Positron.
	 *
	 * @param runtimeId The ID of the runtime to select and start.
	 * @param sessionName A human-readable name for the new session.
	 * @param sessionMode The mode in which the session is to be run.
	 * @param notebookUri The URI of the notebook document, if in notebook mode.
	 *
	 * Returns a Thenable that resolves with the newly created session, or
	 * rejects with an error.
	 */
	public async startLanguageRuntime(runtimeId: string,
		sessionName: string,
		sessionMode: LanguageRuntimeSessionMode,
		notebookUri: URI | undefined): Promise<positron.LanguageRuntimeSession> {

		// Start the runtime and get the session ID
		const sessionId =
			await this._proxy.$startLanguageRuntime(runtimeId, sessionName, sessionMode, notebookUri);

		// The process of starting a session in Positron should have caused the
		// runtime to be registered with the extension host, so we should be able
		// to find it now.
		const session = this._runtimeSessions.find(
			session => session.metadata.sessionId === sessionId);
		if (!session) {
			throw new Error(`Session ID '${sessionId}' not found.`);
		}
		return session;
	}

	/**
	 * Restarts an active session.
	 *
	 * @param sessionId The session ID to restart.
	 */
	public restartSession(sessionId: string): Promise<void> {
		// Look for the runtime with the given ID
		for (let i = 0; i < this._runtimeSessions.length; i++) {
			if (this._runtimeSessions[i].metadata.sessionId === sessionId) {
				return this._proxy.$restartSession(i);
			}
		}
		return Promise.reject(
			new Error(`Session with ID '${sessionId}' must be started before ` +
				`it can be restarted.`));
	}

	public focusSession(sessionId: string): void {
		for (let i = 0; i < this._runtimeSessions.length; i++) {
			if (this._runtimeSessions[i].metadata.sessionId === sessionId) {
				return this._proxy.$focusSession(i);
			}
		}
		throw new Error(`Session with ID '${sessionId}' must be started before ` +
			`it can be focused.`);
	}

	/**
	 * Interrupts an active session.
	 *
	 * @param sessionId The session ID to restart.
	 */
	interruptSession(sessionId: string): Promise<void> {
		// Look for the runtime with the given ID
		for (let i = 0; i < this._runtimeSessions.length; i++) {
			if (this._runtimeSessions[i].metadata.sessionId === sessionId) {
				return this._proxy.$interruptSession(i);
			}
		}
		return Promise.reject(
			new Error(`Session with ID '${sessionId}' must be started before ` +
				`it can be interrupted.`));
	}

	/**
	 * Handles a comm open message from the language runtime by either creating
	 * a client instance for it or passing it to a registered client handler.
	 *
	 * @param handle The handle of the language runtime
	 * @param message The message to handle
	 */
	private handleCommOpen(handle: number, message: ILanguageRuntimeMessageCommOpen): void {
		// Create a client instance for the comm
		const clientInstance = new ExtHostRuntimeClientInstance(message,
			(id, data) => {
				// Callback to send a message to the runtime
				this._runtimeSessions[handle].sendClientMessage(message.comm_id, id, data);
			},
			() => {
				// Callback to remove the client instance
				this._runtimeSessions[handle].removeClient(message.comm_id);
			});

		// Dispose the client instance when the runtime exits
		this._runtimeSessions[handle].onDidChangeRuntimeState(state => {
			if (state === RuntimeState.Exited) {
				// Mark the client instance as already closed so disposal
				// doesn't try to close it
				clientInstance.setClientState(RuntimeClientState.Closed);
				clientInstance.dispose();
			}
		});

		// See if one of the registered client handlers wants to handle this
		let handled = false;
		for (const handler of this._clientHandlers) {
			// If the client type matches, then call the handler
			if (message.target_name === handler.clientType) {
				// If the handler returns true, then it'll take it from here
				if (handler.callback(clientInstance, message.data)) {
					// Add the client instance to the list
					this._clientInstances.push(clientInstance);
					handled = true;
				}
			}
		}

		// Notify the main thread that a client has been opened.
		this._proxy.$emitLanguageRuntimeMessage(handle, handled, new SerializableObjectWithBuffers(message));
	}

	/**
	 * Handles a comm data message from the language runtime
	 *
	 * @param handle The handle of the language runtime
	 * @param message The message to handle
	 */
	private handleCommData(handle: number, message: ILanguageRuntimeMessageCommData): void {
		// Check to see if this message is handled by an active client instance
		// tracked by the extension host
		const clientInstance = this._clientInstances.find(instance =>
			instance.getClientId() === message.comm_id);
		let handled = false;
		if (clientInstance) {
			clientInstance.emitMessage(message);
			handled = true;
		}

		// Check to see if this message is owned by a registered client ID
		if (!handled && this._registeredClientIds.has(message.comm_id)) {
			handled = true;
		}

		// Notify the main thread that a comm data message has been received,
		// and whether it was handled in the extension host
		this._proxy.$emitLanguageRuntimeMessage(handle, handled, new SerializableObjectWithBuffers(message));
	}

	/**
	 * Handles a comm closed message from the language runtime
	 *
	 * @param handle The handle of the language runtime
	 * @param message The message to handle
	 */
	private handleCommClosed(handle: number, message: ILanguageRuntimeMessageCommClosed): void {
		// See if this client instance is still active
		const idx = this._clientInstances.findIndex(instance =>
			instance.getClientId() === message.comm_id);
		let handled = false;
		if (idx >= 0) {
			// If it is, dispose and remove it
			const clientInstance = this._clientInstances[idx];
			clientInstance.dispose();
			this._clientInstances.splice(idx, 1);
			handled = true;
		}

		this._proxy.$emitLanguageRuntimeMessage(handle, handled, new SerializableObjectWithBuffers(message));
	}

	/**
	 * Handles a message for an execution with an observer
	 * @param message The message to handle
	 * @param observer The observer for the execution
	 */
	private handleObserverMessage(message: ILanguageRuntimeMessage, o: ExecutionObserver): void {
		switch (message.type) {
			case LanguageRuntimeMessageType.Stream:
				o.onStreamMessage(message as ILanguageRuntimeMessageStream);
				break;

			case LanguageRuntimeMessageType.Output:
				o.onOutputMessage(message as ILanguageRuntimeMessageOutput);
				break;

			case LanguageRuntimeMessageType.State:
				o.onStateMessage(message as ILanguageRuntimeMessageState);
				break;

			case LanguageRuntimeMessageType.Result:
				o.onCompleted((message as ILanguageRuntimeMessageResult).data);
				break;

			case LanguageRuntimeMessageType.Error:
				o.onErrorMessage(message as ILanguageRuntimeMessageError);
				break;
		}

		if (message.type === LanguageRuntimeMessageType.State) {
			const stateMessage = message as ILanguageRuntimeMessageState;
			if (stateMessage.state === RuntimeOnlineState.Idle) {
				// Clean up the observer
				const executionId = message.parent_id;
				if (executionId) {
					o.dispose();
					this._executionObservers.delete(executionId);
				}
			}
		}
	}
}
