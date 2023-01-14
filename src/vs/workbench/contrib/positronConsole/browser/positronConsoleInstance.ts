/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { HistoryNavigator2 } from 'vs/base/common/history';
import { ILanguageRuntime } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IPositronConsoleInstance } from 'vs/workbench/services/positronConsole/common/positronConsole';

export class PositronConsoleInstance extends Disposable implements IPositronConsoleInstance {

	private readonly _onDidClearConsole = this._register(new Emitter<void>);
	readonly onDidClearConsole: Event<void> = this._onDidClearConsole.event;

	private readonly _onDidExecuteCode = this._register(new Emitter<string>);
	readonly onDidExecuteCode: Event<string> = this._onDidExecuteCode.event;

	readonly history: HistoryNavigator2<string> = new HistoryNavigator2([''], 1000);

	constructor(
		readonly languageId: string,
		readonly runtime: ILanguageRuntime) {
		super();
	}

	clear(): void {
		this._onDidClearConsole.fire();
	}

	executeCode(code: string): void {
		this._onDidExecuteCode.fire(code);
	}
}
