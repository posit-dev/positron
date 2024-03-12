/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type * as positron from 'positron';
import { ILanguageRuntimeMessage, ILanguageRuntimeMessageCommClosed, ILanguageRuntimeMessageCommData, ILanguageRuntimeMessageCommOpen, ILanguageRuntimeMetadata, LanguageRuntimeSessionMode, RuntimeCodeExecutionMode, RuntimeCodeFragmentStatus, RuntimeErrorBehavior, RuntimeState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import * as extHostProtocol from './extHost.positron.protocol';
import { Emitter } from 'vs/base/common/event';
import { DisposableStore, IDisposable } from 'vs/base/common/lifecycle';
import { Disposable, LanguageRuntimeMessageType } from 'vs/workbench/api/common/extHostTypes';
import { RuntimeClientType } from 'vs/workbench/api/common/positron/extHostTypes.positron';
import { ExtHostRuntimeClientInstance } from 'vs/workbench/api/common/positron/extHostClientInstance';
import { ExtensionIdentifier, IExtensionDescription } from 'vs/platform/extensions/common/extensions';
import { URI } from 'vs/base/common/uri';
import { DeferredPromise } from 'vs/base/common/async';
import { IRuntimeSessionMetadata } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';

/**
 * A language runtime manager and metadata about the extension that registered it.
 */
interface LanguageRuntimeManager {
	manager: positron.LanguageRuntimeManager;
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

	constructor(
		mainContext: extHostProtocol.IMainPositronContext
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
		const sessionManager = await this.runtimeManagerForRuntime(runtimeMetadata);
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
	 * Validates an ILanguageRuntimeMetadata object; typically used to validate
	 * stored metadata prior to starting a runtime.
	 *
	 * @param metadata The metadata to validate
	 * @returns An updated metadata object
	 */
	async $validateLangaugeRuntimeMetadata(metadata: ILanguageRuntimeMetadata):
		Promise<ILanguageRuntimeMetadata> {
		// Find the runtime manager that should be used for this metadata
		const m = await this.runtimeManagerForRuntime(metadata);
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
		const sessionManager = await this.runtimeManagerForRuntime(runtimeMetadata);
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
	 * If it can't find the runtime manager, then it will wait until the runtime
	 * manager is registered (up to 10 seconds). If the runtime manager is not
	 * registered within that time, then it will reject the promise.
	 *
	 * @param metadata The metadata for the runtime
	 *
	 * @returns A promise that resolves with the runtime manager for the
	 * runtime.
	 */
	private async runtimeManagerForRuntime(metadata: ILanguageRuntimeMetadata): Promise<LanguageRuntimeManager | undefined> {
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
		});

		session.onDidReceiveRuntimeMessage(message => {
			const tick = this._eventClocks[handle] = this._eventClocks[handle] + 1;
			// Amend the message with the event clock for ordering
			const runtimeMessage: ILanguageRuntimeMessage = {
				event_clock: tick,
				...message
			};

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
					this._proxy.$emitLanguageRuntimeMessage(handle, runtimeMessage);
					break;
			}
		});

		// Hook up the session end (exit) handler
		session.onDidEndSession(exit => {
			this._proxy.$emitLanguageRuntimeExit(handle, exit);
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
		return this._runtimeSessions[handle].interrupt();
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

	async $restartSession(handle: number): Promise<void> {
		if (handle >= this._runtimeSessions.length) {
			throw new Error(`Cannot restart runtime: session handle '${handle}' not found or no longer valid.`);
		}
		return this._runtimeSessions[handle].restart();
	}

	async $startLanguageRuntime(handle: number): Promise<positron.LanguageRuntimeInfo> {
		if (handle >= this._runtimeSessions.length) {
			throw new Error(`Cannot restart runtime: session handle '${handle}' not found or no longer valid.`);
		}
		return this._runtimeSessions[handle].start();
	}

	$showOutputLanguageRuntime(handle: number): void {
		if (handle >= this._runtimeSessions.length) {
			throw new Error(`Cannot show output for runtime: language runtime session handle '${handle}' not found or no longer valid.`);
		}
		if (!this._runtimeSessions[handle].showOutput) {
			throw new Error(`Cannot show output for runtime: language runtime session handle '${handle}' does not implement logging.`);
		}
		return this._runtimeSessions[handle].showOutput!();
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

	$createClient(handle: number, id: string, type: RuntimeClientType, params: any): Promise<void> {
		if (handle >= this._runtimeSessions.length) {
			throw new Error(`Cannot create '${type}' client: session handle '${handle}' not found or no longer valid.`);
		}
		return Promise.resolve(this._runtimeSessions[handle].createClient(id, type, params));
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

	/**
	 * Discovers language runtimes and registers them with the main thread.
	 */
	public async $discoverLanguageRuntimes(): Promise<void> {
		// Extract all the runtime discoverers from the runtime managers
		let start = 0;
		let end = this._runtimeManagers.length;

		// Discover runtimes from each provider in parallel
		while (start !== end) {
			// Extract the section of the providers list we're working on and discover
			// runtimes from it
			const managers = this._runtimeManagers.slice(start, end);
			try {
				await this.discoverLanguageRuntimes(managers);
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
	 * Discovers language runtimes in parallel and registers each one with the main thread.
	 *
	 * @param discoverers The set of discoverers to discover runtimes from
	 */
	private async discoverLanguageRuntimes(managers: Array<LanguageRuntimeManager>): Promise<void> {

		// The number of discoverers we're waiting on (initially all discoverers)
		let count = managers.length;

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
			discoverer: manager.manager.discoverRuntimes()
		}));

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

	public getRegisteredRuntimes(): Promise<positron.LanguageRuntimeMetadata[]> {
		return Promise.resolve(this._registeredRuntimes);
	}

	public async getPreferredRuntime(languageId: string): Promise<positron.LanguageRuntimeMetadata> {
		const metadata = await this._proxy.$getPreferredRuntime(languageId);
		const runtime = this._registeredRuntimes.find(runtime => runtime.runtimeId === metadata.runtimeId);
		if (!runtime) {
			throw new Error(`Runtime exists on main thread but not extension host: ${metadata.runtimeId}`);
		}
		return runtime;
	}

	/**
	 * Registers a new language runtime manager with the extension host.
	 *
	 * @param extension The extension that is registering the manager
	 * @param manager The manager to register
	 * @returns A disposable that unregisters the manager when disposed
	 */
	public registerLanguageRuntimeManager(
		extension: IExtensionDescription,
		manager: positron.LanguageRuntimeManager): IDisposable {

		const disposables = new DisposableStore();

		// If we were waiting for this runtime manager to be registered, then
		// resolve the promise now.
		const pending = this._pendingRuntimeManagers.get(ExtensionIdentifier.toKey(extension.identifier));
		if (pending) {
			pending.complete({ manager, extension });
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
				const discoverer = manager.discoverRuntimes();
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

		this._runtimeManagers.push({ manager, extension });

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
		this._runtimeManagersByRuntimeId.set(runtime.runtimeId, { manager, extension });

		return new Disposable(() => {
			this._proxy.$unregisterLanguageRuntime(handle);
		});
	}

	public executeCode(languageId: string, code: string, focus: boolean, skipChecks?: boolean): Promise<boolean> {
		return this._proxy.$executeCode(languageId, code, focus, skipChecks);
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
				clientInstance.dispose();
			}
		});

		// See if one of the registered client handlers wants to handle this
		for (const handler of this._clientHandlers) {
			// If the client type matches, then call the handler
			if (message.target_name === handler.clientType) {
				// If the handler returns true, then it'll take it from here
				if (handler.callback(clientInstance, message.data)) {
					// Add the client instance to the list
					this._clientInstances.push(clientInstance);
				}
			}
		}

		// Notify the main thread that a client has been opened.
		//
		// Consider: should this event include information on whether a client
		// handler took ownership of the client?
		this._proxy.$emitLanguageRuntimeMessage(handle, message);
	}

	/**
	 * Handles a comm data message from the language runtime
	 *
	 * @param handle The handle of the language runtime
	 * @param message The message to handle
	 */
	private handleCommData(handle: number, message: ILanguageRuntimeMessageCommData): void {
		// Find the client instance
		const clientInstance = this._clientInstances.find(instance =>
			instance.getClientId() === message.comm_id);
		if (clientInstance) {
			clientInstance.emitMessage(message);
		}

		this._proxy.$emitLanguageRuntimeMessage(handle, message);
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
		if (idx >= 0) {
			// If it is, dispose and remove it
			const clientInstance = this._clientInstances[idx];
			clientInstance.dispose();
			this._clientInstances.splice(idx, 1);
		}

		this._proxy.$emitLanguageRuntimeMessage(handle, message);
	}
}
