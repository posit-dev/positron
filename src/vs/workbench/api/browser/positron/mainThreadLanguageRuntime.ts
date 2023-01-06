/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import {
	ExtHostLanguageRuntimeShape,
	MainThreadLanguageRuntimeShape,
	MainPositronContext,
	ExtHostPositronContext
} from '../../common/positron/extHost.positron.protocol';
import { extHostNamedCustomer, IExtHostContext } from 'vs/workbench/services/extensions/common/extHostCustomers';
import { ILanguageRuntime, ILanguageRuntimeInfo, ILanguageRuntimeMessage, ILanguageRuntimeMetadata, ILanguageRuntimeService, IRuntimeClientInstance, LanguageRuntimeHistoryType, RuntimeClientState, RuntimeClientType, RuntimeCodeExecutionMode, RuntimeCodeFragmentStatus, RuntimeErrorBehavior, RuntimeState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { Event, Emitter } from 'vs/base/common/event';

// Adapter class; presents an ILanguageRuntime interface that connects to the
// extension host proxy to supply language features.
class ExtHostLanguageRuntimeAdapter implements ILanguageRuntime {

	private readonly _stateEmitter = new Emitter<RuntimeState>();
	private readonly _messageEmitter = new Emitter<ILanguageRuntimeMessage>();
	private readonly _startupEmitter = new Emitter<ILanguageRuntimeInfo>();
	private _currentState: RuntimeState = RuntimeState.Uninitialized;
	private _clients: Map<string, ExtHostRuntimeClientInstance> = new Map<string, ExtHostRuntimeClientInstance>();

	constructor(readonly handle: number,
		readonly metadata: ILanguageRuntimeMetadata,
		private readonly _proxy: ExtHostLanguageRuntimeShape) {

		// Bind events to emitters
		this.onDidChangeRuntimeState = this._stateEmitter.event;
		this.onDidReceiveRuntimeMessage = this._messageEmitter.event;
		this.onDidCompleteStartup = this._startupEmitter.event;

		// Listen to state changes and track the current state
		this.onDidChangeRuntimeState((state) => {
			this._currentState = state;
		});
	}

	onDidReceiveRuntimeMessage: Event<ILanguageRuntimeMessage>;

	onDidChangeRuntimeState: Event<RuntimeState>;

	onDidCompleteStartup: Event<ILanguageRuntimeInfo>;

	emitMessage(message: ILanguageRuntimeMessage): void {
		this._messageEmitter.fire(message);
	}

	emitState(state: RuntimeState): void {
		this._stateEmitter.fire(state);
	}

	/** Gets the current state of the notebook runtime */
	getRuntimeState(): RuntimeState {
		return this._currentState;
	}

	execute(code: string, id: string, mode: RuntimeCodeExecutionMode, errorBehavior: RuntimeErrorBehavior): void {
		this._proxy.$executeCode(this.handle, code, id, mode, errorBehavior);
	}

	isCodeFragmentComplete(code: string): Thenable<RuntimeCodeFragmentStatus> {
		return this._proxy.$isCodeFragmentComplete(this.handle, code);
	}

	getExecutionHistory(type: LanguageRuntimeHistoryType, max: number): Thenable<string[][]> {
		return this._proxy.$getExecutionHistory(this.handle, type, max);
	}

	/** Create a new client inside the runtime */
	createClient(type: RuntimeClientType): Thenable<IRuntimeClientInstance> {
		return new Promise((resolve, reject) => {
			this._proxy.$createClient(this.handle, type).then((clientId) => {
				const client = new ExtHostRuntimeClientInstance(clientId, type, this.handle, this._proxy);
				this._clients.set(clientId, client);
				resolve(client);
			}).catch((err) => {
				reject(err);
			});
		});
	}

	/** List active clients */
	listClients(): Thenable<IRuntimeClientInstance[]> {
		return Promise.resolve(Array.from(this._clients.values()));
	}

	replyToPrompt(id: string, value: string): void {
		this._proxy.$replyToPrompt(this.handle, id, value);
	}

	interrupt(): void {
		return this._proxy.$interruptLanguageRuntime(this.handle);
	}

	restart(): void {
		return this._proxy.$restartLanguageRuntime(this.handle);
	}

	shutdown(): void {
		return this._proxy.$shutdownLanguageRuntime(this.handle);
	}

	start(): Promise<ILanguageRuntimeInfo> {
		return new Promise((resolve, reject) => {
			this._proxy.$startLanguageRuntime(this.handle).then((info) => {
				this._startupEmitter.fire(info);
				resolve(info);
			}).catch((err) => {
				reject(err);
			});
		});
	}
}

/**
 * Represents the front-end instance of a client widget inside a language runtime.
 *
 * Its lifetime is tied to the lifetime of the client widget and associated server
 * component. It is presumed that the comm channel has already been established
 * between the client and server; this class is responsible for managing the
 * communication channel and closing it when the client is disposed.
 */
class ExtHostRuntimeClientInstance extends Disposable implements IRuntimeClientInstance {

	private readonly _stateEmitter = new Emitter<RuntimeClientState>();

	private _state: RuntimeClientState = RuntimeClientState.Uninitialized;

	constructor(
		private readonly _id: string,
		private readonly _type: RuntimeClientType,
		private readonly _handle: number,
		private readonly _proxy: ExtHostLanguageRuntimeShape) {
		super();

		this.onDidChangeClientState = this._stateEmitter.event;
		this._register(this._stateEmitter);

		this._stateEmitter.event((state) => {
			this._state = state;
		});
	}

	/**
	 * Sends a message (of any type) to the server side of the comm.
	 *
	 * @param message Message to send to the server
	 */
	sendMessage(message: any): void {
		this._proxy.$sendClientMessage(this._handle, this._id, message);
	}

	onDidChangeClientState: Event<RuntimeClientState>;

	getClientState(): RuntimeClientState {
		return this._state;
	}

	getClientId(): string {
		return this._id;
	}

	getClientType(): RuntimeClientType {
		return this._type;
	}

	public override dispose(): void {
		super.dispose();
		this._proxy.$removeClient(this._handle, this._id);
		this._stateEmitter.fire(RuntimeClientState.Closed);
	}
}

@extHostNamedCustomer(MainPositronContext.MainThreadLanguageRuntime)
export class MainThreadLanguageRuntime implements MainThreadLanguageRuntimeShape {

	private readonly _disposables = new DisposableStore();

	private readonly _proxy: ExtHostLanguageRuntimeShape;

	private readonly _runtimes: Map<number, ExtHostLanguageRuntimeAdapter> = new Map();

	constructor(
		extHostContext: IExtHostContext,
		@ILanguageRuntimeService private readonly _languageRuntimeService: ILanguageRuntimeService
	) {
		this._proxy = extHostContext.getProxy(ExtHostPositronContext.ExtHostLanguageRuntime);
	}

	$emitRuntimeClientMessage(handle: number, id: string, message: ILanguageRuntimeMessage): void {
		throw new Error('Method not implemented.');
	}

	$emitRuntimeClientState(handle: number, id: string, state: RuntimeClientState): void {
		throw new Error('Method not implemented.');
	}

	$emitLanguageRuntimeMessage(handle: number, message: ILanguageRuntimeMessage): void {
		const runtime = this._runtimes.get(handle);
		if (runtime) {
			runtime.emitMessage(message);
		} else {
			throw new Error(`Unknown language runtime handle: ${handle}`);
		}
	}

	$emitLanguageRuntimeState(handle: number, state: RuntimeState): void {
		const runtime = this._runtimes.get(handle);
		if (runtime) {
			runtime.emitState(state);
		} else {
			throw new Error(`Unknown language runtime handle: ${handle}`);
		}
	}

	// Called by the extension host to register a language runtime
	$registerLanguageRuntime(handle: number, metadata: ILanguageRuntimeMetadata): void {
		const adapter = new ExtHostLanguageRuntimeAdapter(handle, metadata, this._proxy);
		this._runtimes.set(handle, adapter);

		// Consider - do we need a flag (on the API side) to indicate whether
		// the runtime should be started implicitly?
		this._languageRuntimeService.registerRuntime(adapter,
			metadata.startupBehavior);
	}

	$unregisterLanguageRuntime(handle: number): void {
		this._runtimes.delete(handle);
	}

	public dispose(): void {
		this._disposables.dispose();
	}
}
