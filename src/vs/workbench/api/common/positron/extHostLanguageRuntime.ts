/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type * as positron from 'positron';
import { ILanguageRuntimeInfo, ILanguageRuntimeMessage, ILanguageRuntimeMessageCommData, ILanguageRuntimeMessageCommOpen, RuntimeCodeExecutionMode, RuntimeCodeFragmentStatus, RuntimeErrorBehavior } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import * as extHostProtocol from './extHost.positron.protocol';
import { IDisposable } from 'vs/base/common/lifecycle';
import { Disposable, LanguageRuntimeMessageType } from 'vs/workbench/api/common/extHostTypes';
import { RuntimeClientType } from 'vs/workbench/api/common/positron/extHostTypes.positron';
import { ExtHostRuntimeClientInstance } from 'vs/workbench/api/common/positron/extHostClientInstance';

export class ExtHostLanguageRuntime implements extHostProtocol.ExtHostLanguageRuntimeShape {

	private readonly _proxy: extHostProtocol.MainThreadLanguageRuntimeShape;

	private readonly _runtimes = new Array<positron.LanguageRuntime>();

	private readonly _runtimeProviders = new Array<positron.LanguageRuntimeProvider>();

	private readonly _clientInstances = new Array<ExtHostRuntimeClientInstance>();

	private readonly _clientHandlers = new Array<positron.RuntimeClientHandler>();

	/**
	 * Lamport clocks, used for event ordering. Each runtime has its own clock since
	 * events are only ordered within a runtime.
	 */
	private _eventClocks = new Array<number>();

	constructor(
		mainContext: extHostProtocol.IMainPositronContext
	) {
		// Trigger creation of the proxy
		this._proxy = mainContext.getProxy(extHostProtocol.MainPositronContext.MainThreadLanguageRuntime);
	}

	$startLanguageRuntime(handle: number): Promise<ILanguageRuntimeInfo> {
		return new Promise((resolve, reject) => {
			if (handle >= this._runtimes.length) {
				return reject(new Error(`Cannot start runtime: language runtime handle '${handle}' not found or no longer valid.`));
			}
			this._runtimes[handle].start().then(info => {
				resolve(info);
			}, err => {
				reject(err);
			});
		});
	}

	async $interruptLanguageRuntime(handle: number): Promise<void> {
		if (handle >= this._runtimes.length) {
			throw new Error(`Cannot interrupt runtime: language runtime handle '${handle}' not found or no longer valid.`);
		}
		return this._runtimes[handle].interrupt();
	}

	async $shutdownLanguageRuntime(handle: number): Promise<void> {
		if (handle >= this._runtimes.length) {
			throw new Error(`Cannot shut down runtime: language runtime handle '${handle}' not found or no longer valid.`);
		}
		return this._runtimes[handle].shutdown();
	}

	async $restartLanguageRuntime(handle: number): Promise<void> {
		if (handle >= this._runtimes.length) {
			throw new Error(`Cannot restart runtime: language runtime handle '${handle}' not found or no longer valid.`);
		}
		return this._runtimes[handle].restart();
	}

	$executeCode(handle: number, code: string, id: string, mode: RuntimeCodeExecutionMode, errorBehavior: RuntimeErrorBehavior): void {
		if (handle >= this._runtimes.length) {
			throw new Error(`Cannot execute code: language runtime handle '${handle}' not found or no longer valid.`);
		}
		this._runtimes[handle].execute(code, id, mode, errorBehavior);
	}

	$isCodeFragmentComplete(handle: number, code: string): Promise<RuntimeCodeFragmentStatus> {
		if (handle >= this._runtimes.length) {
			throw new Error(`Cannot test code completeness: language runtime handle '${handle}' not found or no longer valid.`);
		}
		return Promise.resolve(this._runtimes[handle].isCodeFragmentComplete(code));
	}

	$createClient(handle: number, id: string, type: RuntimeClientType, params: any): Promise<void> {
		if (handle >= this._runtimes.length) {
			throw new Error(`Cannot create '${type}' client: language runtime handle '${handle}' not found or no longer valid.`);
		}
		return Promise.resolve(this._runtimes[handle].createClient(id, type, params));
	}

	$listClients(handle: number, type?: RuntimeClientType): Promise<Record<string, string>> {
		if (handle >= this._runtimes.length) {
			throw new Error(`Cannot list clients: language runtime handle '${handle}' not found or no longer valid.`);
		}
		return Promise.resolve(this._runtimes[handle].listClients(type));
	}

	$removeClient(handle: number, id: string): void {
		if (handle >= this._runtimes.length) {
			throw new Error(`Cannot remove client: language runtime handle '${handle}' not found or no longer valid.`);
		}
		this._runtimes[handle].removeClient(id);
	}

	$sendClientMessage(handle: number, client_id: string, message_id: string, message: any): void {
		if (handle >= this._runtimes.length) {
			throw new Error(`Cannot send message to client: language runtime handle '${handle}' not found or no longer valid.`);
		}
		this._runtimes[handle].sendClientMessage(client_id, message_id, message);
	}

	$replyToPrompt(handle: number, id: string, response: string): void {
		if (handle >= this._runtimes.length) {
			throw new Error(`Cannot reply to prompt: language runtime handle '${handle}' not found or no longer valid.`);
		}
		this._runtimes[handle].replyToPrompt(id, response);
	}

	/**
	 * Discovers language runtimes and registers them with the main thread.
	 */
	public async $discoverLanguageRuntimes(): Promise<void> {

		const providers = this._runtimeProviders;

		// The number of providers we're waiting on (initially all providers)
		let count = this._runtimeProviders.length;

		// Utility promise
		const never: Promise<never> = new Promise(() => { });

		// Utility function to get the next runtime from a provider and amend an
		// index
		const getNext = (asyncGen: positron.LanguageRuntimeProvider, index: number) =>
			asyncGen.next().then((result) => ({ index, result }));

		// Array mapping each provider to a promise for its next runtime
		const nextPromises = providers.map(getNext);

		try {
			while (count) {
				// Wait for the next runtime to be discovered from any provider
				const { index, result } = await Promise.race(nextPromises);
				if (result.done) {
					// If the provider is done supplying runtimes, remove it
					// from the list of providers we're waiting on
					nextPromises[index] = never;
					count--;
				} else {
					// Otherwise, move on to the next runtime from the provider
					// and register the runtime it returned
					nextPromises[index] = getNext(providers[index], index);
					this.registerLanguageRuntime(result.value);
				}
			}
		} finally {
			// Clean up any remaining promises
			for (const [index, iterator] of providers.entries()) {
				if (nextPromises[index] !== never && iterator.return !== null) {
					void iterator.return(null);
				}
			}

			// Notify the main thread that discovery is complete
			this._proxy.$completeLanguageRuntimeDiscovery();
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

	public getRunningRuntimes(languageId: string): Promise<positron.LanguageRuntimeMetadata[]> {
		return this._proxy.$getRunningRuntimes(languageId);
	}

	public registerLanguageRuntimeProvider(
		languageId: string,
		provider: positron.LanguageRuntimeProvider): void {
		this._proxy.$isLanguageRuntimeDiscoveryComplete().then(complete => {
			if (complete) {
				// We missed the discovery phase. Invoke the provider's async
				// generator and register each runtime it returns right away.
				void (async () => {
					for await (const runtime of provider) {
						this.registerLanguageRuntime(runtime);
					}
				})();
			} else {
				// We didn't miss it; save the provider for later invocation
				this._runtimeProviders.push(provider);
			}
		});
	}

	public registerLanguageRuntime(
		runtime: positron.LanguageRuntime): IDisposable {

		// Create a handle and register the runtime with the main thread
		const handle = this._runtimes.length;

		// Wire event handlers for state changes and messages
		runtime.onDidChangeRuntimeState(state => {
			const tick = this._eventClocks[handle] = this._eventClocks[handle] + 1;
			this._proxy.$emitLanguageRuntimeState(handle, tick, state);
		});

		runtime.onDidReceiveRuntimeMessage(message => {
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

				// Pass everything else to the main thread
				default:
					this._proxy.$emitLanguageRuntimeMessage(handle, runtimeMessage);
					break;
			}
		});

		// Register the runtime
		this._runtimes.push(runtime);
		this._eventClocks.push(0);

		// Register the runtime with the main thread
		this._proxy.$registerLanguageRuntime(handle, runtime.metadata, runtime.dynState);
		return new Disposable(() => {
			this._proxy.$unregisterLanguageRuntime(handle);
		});
	}

	public executeCode(languageId: string, code: string, focus: boolean): Promise<boolean> {
		return this._proxy.$executeCode(languageId, code, focus);
	}

	/**
	 * Selects and starts a language runtime.
	 *
	 * @param runtimeId The runtime ID to select and start.
	 */
	public selectLanguageRuntime(runtimeId: string): Promise<void> {
		// Look for the runtime with the given ID
		for (let i = 0; i < this._runtimes.length; i++) {
			if (this._runtimes[i].metadata.runtimeId === runtimeId) {
				return this._proxy.$selectLanguageRuntime(i);
			}
		}
		return Promise.reject(
			new Error(`Runtime with ID '${runtimeId}' must be registered before ` +
				`it can be selected.`));
	}

	/**
	 * Restarts a running language runtime.
	 *
	 * @param runtimeId The runtime ID to restart.
	 */
	public restartLanguageRuntime(runtimeId: string): Promise<void> {
		// Look for the runtime with the given ID
		for (let i = 0; i < this._runtimes.length; i++) {
			if (this._runtimes[i].metadata.runtimeId === runtimeId) {
				return this._proxy.$restartLanguageRuntime(i);
			}
		}
		return Promise.reject(
			new Error(`Runtime with ID '${runtimeId}' must be registered before ` +
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
				this._runtimes[handle].sendClientMessage(message.comm_id, id, data);
			},
			() => {
				// Callback to remove the client instance
				this._runtimes[handle].removeClient(message.comm_id);
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
}
