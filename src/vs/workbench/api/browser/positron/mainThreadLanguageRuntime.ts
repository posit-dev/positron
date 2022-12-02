/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import {
	ExtHostLanguageRuntimeShape,
	MainThreadLanguageRuntimeShape,
	MainPositronContext,
	ExtHostPositronContext
} from '../../common/positron/extHost.positron.protocol';
import { extHostNamedCustomer, IExtHostContext } from 'vs/workbench/services/extensions/common/extHostCustomers';
import { ILanguageRuntime, ILanguageRuntimeInfo, ILanguageRuntimeMessage, ILanguageRuntimeMetadata, ILanguageRuntimeService, LanguageRuntimeStartupBehavior, RuntimeCodeExecutionMode, RuntimeErrorBehavior, RuntimeState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { Event, Emitter } from 'vs/base/common/event';

// Adapter class; presents an ILanguageRuntime interface that connects to the
// extension host proxy to supply language features.
class ExtHostLanguageRuntimeAdapter implements ILanguageRuntime {

	private readonly _stateEmitter = new Emitter<RuntimeState>();
	private readonly _messageEmitter = new Emitter<ILanguageRuntimeMessage>();
	private readonly _startupEmitter = new Emitter<ILanguageRuntimeInfo>();
	private _currentState: RuntimeState = RuntimeState.Uninitialized;

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

	onDidCompleteStartup: Event<ILanguageRuntimeInfo>;

	onDidReceiveRuntimeMessage: Event<ILanguageRuntimeMessage>;

	onDidChangeRuntimeState: Event<RuntimeState>;

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
			LanguageRuntimeStartupBehavior.Implicit);
	}

	$unregisterLanguageRuntime(handle: number): void {
		this._runtimes.delete(handle);
	}

	public dispose(): void {
		this._disposables.dispose();
	}
}
