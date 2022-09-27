/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { ILanguageRuntime, ILanguageRuntimeMessage, RuntimeState } from 'vs/workbench/contrib/languageRuntime/common/languageRuntimeService';
import { Emitter } from 'vs/base/common/event';
import * as extHostProtocol from '../extHost.protocol';

class ExtHostLanguageWrapper implements ILanguageRuntime, vscode.Disposable {
	constructor(private readonly _runtime: vscode.LanguageRuntime) {
		this.language = _runtime.language;
		this.name = _runtime.name;
		this.version = _runtime.version;
		this.id = _runtime.id;
		this.messages = new Emitter<ILanguageRuntimeMessage>();
		this.state = new Emitter<RuntimeState>();
		_runtime.messages.event(e => this.messages.fire(e));
		_runtime.state.event(e => this.state.fire(e));
	}

	dispose() {
		this.messages.dispose();
	}

	language: string;

	name: string;

	version: string;

	id: string;

	state: Emitter<RuntimeState>;

	messages: Emitter<ILanguageRuntimeMessage>;

	execute(code: string,
		mode: vscode.RuntimeCodeExecutionMode,
		errorBehavior: vscode.RuntimeErrorBehavior): Thenable<string> {
		return this._runtime.execute(code, mode, errorBehavior);
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
	constructor(
		mainContext: extHostProtocol.IMainContext,
	) {
		// Trigger creation of the proxy
		mainContext.getProxy(extHostProtocol.MainContext.MainThreadLanguageRuntime);
	}

	public $registerLanguageRuntime(
		runtime: vscode.LanguageRuntime): vscode.Disposable {
		const wrapper = new ExtHostLanguageWrapper(runtime);
		return wrapper;
	}
}
