/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import { Emitter } from 'vs/base/common/event';
import * as extHostProtocol from './extHost.positron.protocol';
import { ExtHostConsole } from 'vs/workbench/api/common/positron/extHostConsole';
import { ILogService } from 'vs/platform/log/common/log';
import { dispose } from 'vs/base/common/lifecycle';

export class ExtHostConsoleService implements extHostProtocol.ExtHostConsoleServiceShape {

	private _activeConsoleId: string | null = null;

	private readonly _consoles = new Map<string, ExtHostConsole>;

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
	 * Queries the main thread for the current width of the console.
	 *
	 * @returns The width of the console in characters.
	 */
	getConsoleWidth(): Promise<number> {
		return this._proxy.$getConsoleWidth();
	}

	getActiveConsole(): positron.Console | undefined {
		if (!this._activeConsoleId) {
			return undefined;
		}

		const console = this._consoles.get(this._activeConsoleId);

		if (!console) {
			this._logService.warn(`Console ${this._activeConsoleId} is set as the active console, but isn't in the console map.`);
			return undefined;
		}

		return console.getConsole();
	}

	// --- from main thread

	// Called when the console width changes; fires the onDidChangeConsoleWidth event to any
	// extensions that are listening.
	$onDidChangeConsoleWidth(newWidth: number): void {
		this._onDidChangeConsoleWidth.fire(newWidth);
	}

	// Called when a new console instance is started
	$addConsole(id: string): void {
		const console = new ExtHostConsole(id, this._proxy, this._logService);
		this._consoles.set(id, console);
	}

	// Called when a console instance is removed
	$removeConsole(id: string): void {
		const console = this._consoles.get(id);
		this._consoles.delete(id);

		// "Dispose" of an `ExtHostConsole`, ensuring that future API calls warn / error
		dispose(console);
	}

	// Called when the active console changes
	$setActiveConsole(id: string | null): void {
		this._activeConsoleId = id;
	}
}

