/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { Emitter } from '../../../../base/common/event.js';
import * as extHostProtocol from './extHost.positron.protocol.js';
import { ExtHostConsole } from './extHostConsole.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { dispose } from '../../../../base/common/lifecycle.js';
import { ExtHostDocumentsAndEditors } from '../extHostDocumentsAndEditors.js';

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

	private readonly _onDidChangeActiveConsole = new Emitter<positron.Console | undefined>();

	private readonly _onDidChangeActiveConsoleEditor = new Emitter<vscode.TextEditor | undefined>();

	private _activeConsoleSessionId: string | undefined;

	// Guards the startup seed: once a live $onDidChangeActiveConsole arrives we
	// must not let the async startup promise overwrite it.
	private _receivedLiveActiveConsoleEvent = false;

	private readonly _proxy: extHostProtocol.MainThreadConsoleServiceShape;

	constructor(
		mainContext: extHostProtocol.IMainPositronContext,
		private readonly _logService: ILogService,
		private readonly _extHostDocumentsAndEditors: ExtHostDocumentsAndEditors,
	) {
		this._proxy = mainContext.getProxy(extHostProtocol.MainPositronContext.MainThreadConsoleService);

		// Fetch the current active console session on startup so we don't miss
		// consoles that were already active before this ext host started.
		this._proxy.$getActiveConsoleSessionId().then((sessionId) => {
			// A live $onDidChangeActiveConsole event already arrived; skip so we
			// don't overwrite it with a potentially stale startup value.
			if (this._receivedLiveActiveConsoleEvent) {
				return;
			}
			this._activeConsoleSessionId = sessionId;
			// If $addConsole already registered this session before the promise
			// resolved, the re-fire guard in $addConsole was skipped. Fire now.
			if (sessionId !== undefined && this._extHostConsolesBySessionId.has(sessionId)) {
				this._onDidChangeActiveConsole.fire(this.activeConsole);
			}
		});
	}

	onDidChangeConsoleWidth = this._onDidChangeConsoleWidth.event;

	onDidChangeActiveConsole = this._onDidChangeActiveConsole.event;

	onDidChangeActiveConsoleEditor = this._onDidChangeActiveConsoleEditor.event;

	get activeConsole(): positron.Console | undefined {
		if (this._activeConsoleSessionId === undefined) {
			return undefined;
		}
		return this._extHostConsolesBySessionId.get(this._activeConsoleSessionId)?.getConsole();
	}

	get activeConsoleEditor(): vscode.TextEditor | undefined {
		return this._activeConsoleSessionId
			? this._extHostDocumentsAndEditors.getEditor(`console-${this._activeConsoleSessionId}`)?.value
			: undefined;
	}

	/**
	 * Queries the main thread for the current width of the console input.
	 *
	 * @returns The width of the console input in characters.
	 */
	getConsoleWidth(): Promise<number> {
		return this._proxy.$getConsoleWidth();
	}

	/**
	 * Queries the main thread for the console that aligns with this
	 * `languageId`.
	 *
	 * @param languageId The language id to find a console for.
	 * @returns A promise that resolves to a `positron.Console` or `undefined`
	 * if no console can be found.
	 */
	async getConsoleForLanguage(languageId: string): Promise<positron.Console | undefined> {
		const sessionId = await this._proxy.$getSessionIdForLanguage(languageId);

		if (!sessionId) {
			// Main thread says there is no `sessionId` for this `languageId`
			return undefined;
		}

		// Now find the console on the extension host side
		const extHostConsole = this._extHostConsolesBySessionId.get(sessionId);

		if (!extHostConsole) {
			// Extension host says there is no console for this `sessionId`
			// (Should be extremely rare, if not impossible, for main thread and extension host to
			// be out of sync here)
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
	$addConsole(sessionId: string): void {
		const extHostConsole = new ExtHostConsole(sessionId, this._proxy, this._logService);
		this._extHostConsolesBySessionId.set(sessionId, extHostConsole);
		// If the active session ID arrived before this console was registered, re-fire now that
		// the map is populated so listeners receive the resolved console instead of undefined.
		if (sessionId === this._activeConsoleSessionId) {
			this._onDidChangeActiveConsole.fire(this.activeConsole);
		}
	}

	// Called when a console instance is removed
	$removeConsole(sessionId: string): void {
		const extHostConsole = this._extHostConsolesBySessionId.get(sessionId);
		this._extHostConsolesBySessionId.delete(sessionId);
		// "Dispose" of an `ExtHostConsole`, ensuring that future API calls warn / error
		dispose(extHostConsole);
	}

	// Called when the active console changes
	$onDidChangeActiveConsole(sessionId: string | undefined): void {
		this._receivedLiveActiveConsoleEvent = true;
		this._activeConsoleSessionId = sessionId;
		this._onDidChangeActiveConsole.fire(this.activeConsole);
	}

	// Called when the active console editor changes (separate from vscode.window.activeTextEditor).
	// The editorId is derived from the active session, so we fire using the getter which derives
	// the TextEditor from _activeConsoleSessionId (already updated by $onDidChangeActiveConsole).
	$setActiveConsoleEditor(_editorId: string | null): void {
		this._onDidChangeActiveConsoleEditor.fire(this.activeConsoleEditor);
	}
}
