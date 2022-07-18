/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { INotebookKernel } from 'vs/workbench/contrib/notebook/common/notebookKernelService';
import { IReplInstance } from 'vs/workbench/contrib/repl/browser/repl';
import { Emitter, Event } from 'vs/base/common/event';

export class ReplInstance extends Disposable implements IReplInstance {

	private readonly _onDidClearRepl = this._register(new Emitter<void>);
	readonly onDidClearRepl: Event<void> = this._onDidClearRepl.event;

	private readonly _onDidExecuteCode = this._register(new Emitter<string>);
	readonly onDidExecuteCode: Event<string> = this._onDidExecuteCode.event;

	constructor(
		readonly instanceId: number,
		readonly kernel: INotebookKernel) {
		super();
	}

	clear(): void {
		this._onDidClearRepl.fire();
	}

	executeCode(code: string): void {
		this._onDidExecuteCode.fire(code);
	}
}
