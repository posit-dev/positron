/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import { Emitter } from '../../../../base/common/event.js';
import * as extHostProtocol from './extHost.positron.protocol.js';
import { ExtHostConsole } from './extHostConsole.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { dispose } from '../../../../base/common/lifecycle.js';

export class ExtHostConsoleService implements extHostProtocol.ExtHostConsoleServiceShape {

	/**
	 * A Map of session ids to the respective console.
	 * Each session id maps to a single console.
	 * Multiple sessions could map to the same console, this happens
	 * when a user power-cycles the session for a console instance
	 * (i.e. shutdown session for console instance, then start a session for console instance)
	 *
	 * Kept in sync with consoles in `MainThreadConsoleService`
	 */
	private readonly _extHostConsolesBySessionId = new Map<string, ExtHostConsole>();

	private readonly _onDidChangeConsoleWidth = new Emitter<number>();

	private readonly _proxy: extHostProtocol.MainThreadConsoleServiceShape;

	constructor(
		mainContext: extHostProtocol.IMainPositronContext,
		private readonly _logService: ILogService,
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

	getConsoleForLanguage(id: string): positron.Console | undefined {
		// find a console for this langauge id
		const extHostConsole = Array.from(this._extHostConsolesBySessionId.values())
			.find(extHostConsole => extHostConsole.getLanguageId() === id);

		if (!extHostConsole) {
			// Console for this language `id` doesn't exist yet
			return undefined;
		}

		return extHostConsole.getConsole();
	}

	// --- from main thread

	// Called when the console width changes; fires the onDidChangeConsoleWidth event to any
	// extensions that are listening.
	$onDidChangeConsoleWidth(newWidth: number): void {
		this._onDidChangeConsoleWidth.fire(newWidth);
	}

	// Called when a new console instance is started
	$addConsole(id: string): void {
		const extHostConsole = new ExtHostConsole(id, this._proxy, this._logService);
		this._extHostConsolesBySessionId.set(id, extHostConsole);
	}

	// Called when a console instance is removed
	$removeConsole(id: string): void {
		const extHostConsole = this._extHostConsolesBySessionId.get(id);
		this._extHostConsolesBySessionId.delete(id);
		// "Dispose" of an `ExtHostConsole`, ensuring that future API calls warn / error
		dispose(extHostConsole);
	}
}

