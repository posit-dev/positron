/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { EventEmitter } from 'vscode';
import * as extHostProtocol from './extHost.positron.protocol';

export class ExtHostConsole implements extHostProtocol.ExtHostConsoleShape {

	private readonly _onDidChangeConsoleWidth = new EventEmitter<number>();

	constructor(
		mainContext: extHostProtocol.IMainPositronContext
	) {
	}

	onDidChangeConsoleWidth = this._onDidChangeConsoleWidth.event;

	$onDidChangeConsoleWidth(newWidth: number): void {
		this._onDidChangeConsoleWidth.fire(newWidth);
	}
}

