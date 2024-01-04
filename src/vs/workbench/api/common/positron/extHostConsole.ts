/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import * as extHostProtocol from './extHost.positron.protocol';

export class ExtHostConsole implements extHostProtocol.ExtHostConsoleShape {

	private readonly _onDidChangeConsoleWidth = new Emitter<number>();

	private readonly _proxy: extHostProtocol.MainThreadConsoleShape;

	constructor(
		mainContext: extHostProtocol.IMainPositronContext
	) {
		this._proxy = mainContext.getProxy(extHostProtocol.MainPositronContext.MainThreadConsole);
	}

	onDidChangeConsoleWidth = this._onDidChangeConsoleWidth.event;

	/**
	 * Queries the main thread for the current width of the console.
	 *
	 * @returns The width of the console in characters.
	 */
	getConsoleWidth(): Promise<number> {
		return this._proxy.$getConsoleWidth();
	}

	// Called by the main thread when the console width changes; fires the
	// onDidChangeConsoleWidth event to any extensions that are listening.
	$onDidChangeConsoleWidth(newWidth: number): void {
		this._onDidChangeConsoleWidth.fire(newWidth);
	}
}

