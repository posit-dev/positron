/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { HistoryNavigator2 } from 'vs/base/common/history';
import { ILanguageRuntime } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IPositronConsoleInstance } from 'vs/workbench/services/positronConsole/common/positronConsole';


// 	readonly languageId: string;
// 	readonly runtime: ILanguageRuntime;
// 	readonly displayName: string;
// 	readonly history: HistoryNavigator2<string>;
// 	readonly onDidClearConsole: Event<void>;
// 	readonly onDidExecuteCode: Event<string>;
// clear(): void;
// executeCode(code: string): void;

/**
 * PositronConsoleInstance class.
 */
export class PositronConsoleInstance extends Disposable implements IPositronConsoleInstance {
	//#region Private Properties

	private readonly _onDidClearConsoleEmitter = this._register(new Emitter<void>);

	private readonly _onDidExecuteCodeEmitter = this._register(new Emitter<string>);

	//#endregion Private Properties

	/**
	 * Constructor.
	 * @param languageId The language ID.
	 * @param runtime The language runtime.
	 */
	constructor(
		readonly languageId: string,
		readonly runtime: ILanguageRuntime) {
		super();
	}

	/**
	 * Gets the display name.
	 */
	get displayName() {
		// TODO@softwarenerd - Temporary code because R's metadata returns 'r' for the language and something like
		// 'R: /Library/Frameworks/R.framework/Resources' for the name.
		if (this.runtime.metadata.name.startsWith('R')) {
			return 'R';
		} else {
			return this.runtime.metadata.name;
		}
	}

	readonly history: HistoryNavigator2<string> = new HistoryNavigator2([''], 1000); // TODO@softwarenerd - 1000 should come from settings.

	/**
	 * onDidClearConsole event.
	 */
	readonly onDidClearConsole: Event<void> = this._onDidClearConsoleEmitter.event;

	/**
	 * onDidExecuteCode event.
	 */
	readonly onDidExecuteCode: Event<string> = this._onDidExecuteCodeEmitter.event;

	clear(): void {
		this._onDidClearConsoleEmitter.fire();
	}

	executeCode(code: string): void {
		this._onDidExecuteCodeEmitter.fire(code);
	}
}
