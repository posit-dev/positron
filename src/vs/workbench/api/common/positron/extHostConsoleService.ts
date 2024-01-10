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

	// Map of language `id` to console.
	// Assumes each language `id` maps to at most 1 console,
	// which may need to be relaxed in the future.
	// Kept in sync with consoles in `MainThreadConsoleService`.
	private readonly _extHostConsolesByLanguageId = new Map<string, ExtHostConsole>;

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

	getConsoleForLanguage(id: string): positron.Console | undefined {
		const extHostConsole = this._extHostConsolesByLanguageId.get(id);

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
		this._extHostConsolesByLanguageId.set(id, extHostConsole);
	}

	// Called when a console instance is removed
	$removeConsole(id: string): void {
		const extHostConsole = this._extHostConsolesByLanguageId.get(id);
		this._extHostConsolesByLanguageId.delete(id);

		// "Dispose" of an `ExtHostConsole`, ensuring that future API calls warn / error
		dispose(extHostConsole);
	}
}

