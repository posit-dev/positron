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
	 */
	// TODO!: This doesn't survive a browser reload, and we don't really have a good way
	// to revive it. We want to make sure of two things:
	// - If a console is deleted, we update any existing handles to a `positron.Console` to
	//   ensure that it looks disposed and warns on any API usage
	// - If the window is reloaded, we need to be able to still look up the console for
	//   a valid sessionId. The positron console service seems to maintain an up to date
	//   set of consoles, and is probably our source of truth.
	// Is it even possible to hand out a `positron.Console` that survives a browser reload?
	// Or should this be more of an `executeCode()`-like API that works off a `sessionId`?
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

	/**
	 * Get the `positron.Console` that is tied to this `sessionId`
	 *
	 * @param sessionId The session id to retrieve a `positron.Console` for.
	 * @returns A promise that resolves to a `positron.Console` or `undefined`
	 * if no console can be found.
	 */
	async getConsoleForSessionId(sessionId: string): Promise<positron.Console | undefined> {
		const extHostConsole = this._extHostConsolesBySessionId.get(sessionId);

		if (!extHostConsole) {
			// Extension host says there is no console for this `sessionId`
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
	$onDidStartPositronConsoleInstance(sessionId: string): void {
		const extHostConsole = new ExtHostConsole(sessionId, this._proxy, this._logService);
		this._extHostConsolesBySessionId.set(sessionId, extHostConsole);
	}

	// Called when a console instance is deleted
	$onDidDeletePositronConsoleInstance(sessionId: string): void {
		const extHostConsole = this._extHostConsolesBySessionId.get(sessionId);
		this._extHostConsolesBySessionId.delete(sessionId);
		// "Dispose" of an `ExtHostConsole`, ensuring that future API calls warn / error
		dispose(extHostConsole);
	}
}

