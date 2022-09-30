/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { ILanguageRuntime, ILanguageRuntimeInfo, ILanguageRuntimeMessage, RuntimeState } from 'vs/workbench/contrib/languageRuntime/common/languageRuntimeService';
import { Event, Emitter } from 'vs/base/common/event';
import * as extHostProtocol from '../extHost.protocol';
import { IDisposable } from 'vs/base/common/lifecycle';

class ExtHostLanguageWrapper implements ILanguageRuntime, vscode.Disposable {
	private readonly _messagesEmitter: Emitter<ILanguageRuntimeMessage>;
	private readonly _stateEmitter: Emitter<RuntimeState>;
	constructor(private readonly _runtime: vscode.LanguageRuntime) {
		this.language = _runtime.language;
		this.name = _runtime.name;
		this.version = _runtime.version;
		this.id = _runtime.id;
		this._messagesEmitter = new Emitter<ILanguageRuntimeMessage>();
		this._stateEmitter = new Emitter<RuntimeState>();
		this.onDidReceiveRuntimeMessage = this._messagesEmitter.event;
		this.onDidChangeRuntimeState = this._stateEmitter.event;
		_runtime.onDidReceiveRuntimeMessage(e => this._messagesEmitter.fire(e));
		_runtime.onDidChangeRuntimeState(e => this._stateEmitter.fire(e));
	}

	dispose() {
		this._messagesEmitter.dispose();
		this._stateEmitter.dispose();
	}

	language: string;

	name: string;

	version: string;

	id: string;

	onDidReceiveRuntimeMessage: Event<ILanguageRuntimeMessage>;

	onDidChangeRuntimeState: Event<RuntimeState>;

	execute(code: string,
		mode: vscode.RuntimeCodeExecutionMode,
		errorBehavior: vscode.RuntimeErrorBehavior): Thenable<string> {
		return this._runtime.execute(code, mode, errorBehavior);
	}

	start(): Thenable<ILanguageRuntimeInfo> {
		return this._runtime.start();
	}

	interrupt(): void {
		this._runtime.interrupt();
	}

	restart(): void {
		this._runtime.restart();
	}

	shutdown(): void {
		this._runtime.shutdown();
	}
}

export class ExtHostLanguageRuntime {

	private readonly _proxy: extHostProtocol.MainThreadLanguageRuntimeShape;

	constructor(
		mainContext: extHostProtocol.IMainContext,
	) {
		// Trigger creation of the proxy
		this._proxy = mainContext.getProxy(extHostProtocol.MainContext.MainThreadLanguageRuntime);
	}

	public $registerLanguageRuntime(
		runtime: vscode.LanguageRuntime): IDisposable {
		const wrapper = new ExtHostLanguageWrapper(runtime);
		this._proxy.$registerLanguageRuntimeAdapter(wrapper);
		return wrapper;
	}
}
