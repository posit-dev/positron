/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { IReplInstance } from 'vs/workbench/contrib/repl/browser/repl';
import { Emitter, Event } from 'vs/base/common/event';
import { HistoryNavigator2 } from 'vs/base/common/history';
import { ILanguageRuntime } from 'vs/workbench/contrib/languageRuntime/common/languageRuntimeService';

export class ReplInstance extends Disposable implements IReplInstance {

	private readonly _onDidClearRepl = this._register(new Emitter<void>);
	readonly onDidClearRepl: Event<void> = this._onDidClearRepl.event;

	private readonly _onDidExecuteCode = this._register(new Emitter<string>);
	readonly onDidExecuteCode: Event<string> = this._onDidExecuteCode.event;

	readonly history: HistoryNavigator2<string> = new HistoryNavigator2([''], 1000);

	constructor(
		readonly instanceId: number,
		readonly languageId: string,
		readonly kernel: ILanguageRuntime) {
		super();
	}

	clear(): void {
		this._onDidClearRepl.fire();
	}

	executeCode(code: string): void {
		this._onDidExecuteCode.fire(code);
	}
}
