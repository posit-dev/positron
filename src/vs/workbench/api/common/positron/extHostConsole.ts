/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import * as extHostProtocol from './extHost.positron.protocol';

export class ExtHostConsole implements extHostProtocol.ExtHostConsoleShape {

	private readonly _onDidChangeConsoleWidth = new Emitter<number>();

	constructor(
		mainContext: extHostProtocol.IMainPositronContext
	) {
	}

	onDidChangeConsoleWidth = this._onDidChangeConsoleWidth.event;

	// Called by the main thread when the console width changes; fires the
	// onDidChangeConsoleWidth event to any extensions that are listening.
	$onDidChangeConsoleWidth(newWidth: number): void {
		this._onDidChangeConsoleWidth.fire(newWidth);
	}
}

