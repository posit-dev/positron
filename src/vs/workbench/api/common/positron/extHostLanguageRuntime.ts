/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type * as positron from 'positron';
import { ILanguageRuntimeInfo, ILanguageRuntimeMessage, ILanguageRuntimeMessageCommClosed, ILanguageRuntimeMessageCommData, ILanguageRuntimeMessageCommOpen, ILanguageRuntimeMessageError, ILanguageRuntimeMessageEvent, ILanguageRuntimeMessageInput, ILanguageRuntimeMessageOutput, ILanguageRuntimeMessagePrompt, ILanguageRuntimeMessageState, ILanguageRuntimeMessageStream, RuntimeCodeExecutionMode, RuntimeCodeFragmentStatus, RuntimeErrorBehavior } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import * as extHostProtocol from './extHost.positron.protocol';
import { IDisposable } from 'vs/base/common/lifecycle';
import { Disposable, LanguageRuntimeMessageType } from 'vs/workbench/api/common/extHostTypes';
import { RuntimeClientType } from 'vs/workbench/api/common/positron/extHostTypes.positron';
import { ExtHostRuntimeClientInstance } from 'vs/workbench/api/common/positron/extHostClientInstance';

export class ExtHostLanguageRuntime implements extHostProtocol.ExtHostLanguageRuntimeShape {

	private readonly _proxy: extHostProtocol.MainThreadLanguageRuntimeShape;

	private readonly _runtimes = new Array<positron.LanguageRuntime>();

	private readonly _clientInstances = new Array<ExtHostRuntimeClientInstance>();

	private readonly _clientHandlers = new Array<positron.RuntimeClientHandler>();

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

	$interruptLanguageRuntime(handle: number): void {
		if (handle >= this._runtimes.length) {
			throw new Error(`Cannot interrupt runtime: language runtime handle '${handle}' not found or no longer valid.`);
		}
		this._runtimes[handle].interrupt();
	}

	$shutdownLanguageRuntime(handle: number): void {
		if (handle >= this._runtimes.length) {
			throw new Error(`Cannot shut down runtime: language runtime handle '${handle}' not found or no longer valid.`);
		}
		this._runtimes[handle].shutdown();
	}

	$restartLanguageRuntime(handle: number): void {
		if (handle >= this._runtimes.length) {
			throw new Error(`Cannot restart runtime: language runtime handle '${handle}' not found or no longer valid.`);
		}
		this._runtimes[handle].restart();
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

	public registerClientHandler(handler: positron.RuntimeClientHandler): IDisposable {
		this._clientHandlers.push(handler);
		return new Disposable(() => {
			const index = this._clientHandlers.indexOf(handler);
			if (index >= 0) {
				this._clientHandlers.splice(index, 1);
			}
		});
	}

	public registerLanguageRuntime(
		runtime: positron.LanguageRuntime): IDisposable {

		// Create a handle and register the runtime with the main thread
		const handle = this._runtimes.length;

		// Wire event handlers for state changes and messages
		runtime.onDidChangeRuntimeState(state =>
			this._proxy.$emitLanguageRuntimeState(handle, state));

		runtime.onDidReceiveRuntimeMessage(message => {
			// Broker the message type to one of the discrete message events.
			switch (message.type) {
				case LanguageRuntimeMessageType.Stream:
					this._proxy.$emitLanguageRuntimeMessageStream(handle, message as ILanguageRuntimeMessage as ILanguageRuntimeMessageStream);
					break;

				case LanguageRuntimeMessageType.Output:
					this._proxy.$emitLanguageRuntimeMessageOutput(handle, message as ILanguageRuntimeMessage as ILanguageRuntimeMessageOutput);
					break;

				case LanguageRuntimeMessageType.Input:
					this._proxy.$emitLanguageRuntimeMessageInput(handle, message as ILanguageRuntimeMessage as ILanguageRuntimeMessageInput);
					break;

				case LanguageRuntimeMessageType.Error:
					this._proxy.$emitLanguageRuntimeMessageError(handle, message as ILanguageRuntimeMessage as ILanguageRuntimeMessageError);
					break;

				case LanguageRuntimeMessageType.Prompt:
					this._proxy.$emitLanguageRuntimeMessagePrompt(handle, message as ILanguageRuntimeMessage as ILanguageRuntimeMessagePrompt);
					break;

				case LanguageRuntimeMessageType.State:
					this._proxy.$emitLanguageRuntimeMessageState(handle, message as ILanguageRuntimeMessage as ILanguageRuntimeMessageState);
					break;

				case LanguageRuntimeMessageType.Event:
					this._proxy.$emitLanguageRuntimeMessageEvent(handle, message as ILanguageRuntimeMessage as ILanguageRuntimeMessageEvent);
					break;

				case LanguageRuntimeMessageType.CommOpen:
					this.handleCommOpen(handle, message as ILanguageRuntimeMessage as ILanguageRuntimeMessageCommOpen);
					break;

				case LanguageRuntimeMessageType.CommData:
					this.handleCommData(handle, message as ILanguageRuntimeMessage as ILanguageRuntimeMessageCommData);
					break;

				case LanguageRuntimeMessageType.CommClosed:
					this._proxy.$emitRuntimeClientClosed(handle, message as ILanguageRuntimeMessage as ILanguageRuntimeMessageCommClosed);
					break;
			}
		});

		// Register the runtime
		this._runtimes.push(runtime);

		// Register the runtime with the main thread
		this._proxy.$registerLanguageRuntime(handle, runtime.metadata);
		return new Disposable(() => {
			this._proxy.$unregisterLanguageRuntime(handle);
		});
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
					return;
				}
			}
		}

		// If we get here, then no handler took it, so we'll just emit the event
		this._proxy.$emitRuntimeClientOpened(handle, message);
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
		} else {
			this._proxy.$emitRuntimeClientMessage(handle, message);
		}
	}
}
