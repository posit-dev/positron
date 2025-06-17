/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../base/common/event.js';
import * as extHostProtocol from './extHost.positron.protocol.js';

export class ExtHostConsoleService implements extHostProtocol.ExtHostConsoleServiceShape {
	private readonly _onDidChangeConsoleWidth = new Emitter<number>();

	private readonly _proxy: extHostProtocol.MainThreadConsoleServiceShape;

	constructor(
		mainContext: extHostProtocol.IMainPositronContext,
	) {
		this._proxy = mainContext.getProxy(extHostProtocol.MainPositronContext.MainThreadConsoleService);
	}

	onDidChangeConsoleWidth = this._onDidChangeConsoleWidth.event;

	/**
	 * Queries the main thread for the current width of the console input.
	 *
	 * @returns The width of the console input in characters.
	 */
	getConsoleWidth(): Promise<number> {
		return this._proxy.$getConsoleWidth();
	}

	// --- from main thread

	// Called when the console width changes; fires the onDidChangeConsoleWidth event to any
	// extensions that are listening.
	$onDidChangeConsoleWidth(newWidth: number): void {
		this._onDidChangeConsoleWidth.fire(newWidth);
	}
}

