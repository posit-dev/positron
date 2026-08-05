/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { coalesce } from '../../../../base/common/arrays.js';
import { Emitter } from '../../../../base/common/event.js';
import { Lazy } from '../../../../base/common/lazy.js';
import { URI } from '../../../../base/common/uri.js';
import { IEditorPropertiesChangeData, ITextEditorAddData, MainContext, MainThreadTextEditorsShape } from '../extHost.protocol.js';
import * as extHostProtocol from './extHost.positron.protocol.js';
import { ExtHostConsole } from './extHostConsole.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { dispose } from '../../../../base/common/lifecycle.js';
import { ExtHostDocumentsAndEditors } from '../extHostDocumentsAndEditors.js';
import { ExtHostTextEditor } from '../extHostTextEditor.js';
import * as typeConverters from '../extHostTypeConverters.js';

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

	/**
	 * Console input editors, keyed by session id.
	 *
	 * Deliberately held here rather than in `ExtHostDocumentsAndEditors`: these editors must not
	 * surface through the standard VS Code editor APIs (`vscode.window.visibleTextEditors`,
	 * `onDidChangeTextEditorSelection`, ...), only through
	 * `positron.window.activeConsoleEditor` (posit-dev/positron#780).
	 */
	private readonly _consoleEditorsBySessionId = new Map<string, ExtHostTextEditor>();

	private readonly _onDidChangeConsoleWidth = new Emitter<number>();

	private readonly _onDidChangeActiveConsole = new Emitter<positron.Console | undefined>();

	private readonly _onDidChangeActiveConsoleEditor = new Emitter<vscode.TextEditor | undefined>();

	private _activeConsoleSessionId: string | undefined;

	/**
	 * The editor last reported through `onDidChangeActiveConsoleEditor`. The active console and its
	 * editor arrive on separate calls (and in either order), so this suppresses events that would
	 * not change what extensions see.
	 */
	private _notifiedActiveConsoleEditor: vscode.TextEditor | undefined;

	// Guards the startup seed: once a live $onDidChangeActiveConsole arrives we
	// must not let the async startup promise overwrite it.
	private _receivedLiveActiveConsoleEvent = false;

	private readonly _proxy: extHostProtocol.MainThreadConsoleServiceShape;

	private readonly _editorsProxy: MainThreadTextEditorsShape;

	constructor(
		mainContext: extHostProtocol.IMainPositronContext,
		private readonly _logService: ILogService,
		private readonly _extHostDocumentsAndEditors: ExtHostDocumentsAndEditors,
	) {
		this._proxy = mainContext.getProxy(extHostProtocol.MainPositronContext.MainThreadConsoleService);
		// Console editors are addressed by id on the standard text editor channel, so `edit()`,
		// `insertSnippet()` and selection writes work exactly as they do for any other editor.
		this._editorsProxy = mainContext.getProxy(MainContext.MainThreadTextEditors);

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
			this._fireActiveConsoleEditorIfChanged();
		}).catch((err) => {
			// Survivable: extensions just do not see a console that was already active before this
			// extension host started until the next `$onDidChangeActiveConsole`.
			this._logService.error('ExtHostConsoleService: failed to seed the active console', err);
		});
	}

	onDidChangeConsoleWidth = this._onDidChangeConsoleWidth.event;

	onDidChangeActiveConsole = this._onDidChangeActiveConsole.event;

	onDidChangeActiveConsoleEditor = this._onDidChangeActiveConsoleEditor.event;

	/**
	 * The active console. Internal for now: this backs `activeConsoleEditor` and is not exposed on
	 * `positron.window`.
	 */
	get activeConsole(): positron.Console | undefined {
		if (this._activeConsoleSessionId === undefined) {
			return undefined;
		}
		return this._extHostConsolesBySessionId.get(this._activeConsoleSessionId)?.getConsole();
	}

	get activeConsoleEditor(): vscode.TextEditor | undefined {
		return this._activeConsoleSessionId !== undefined
			? this._consoleEditorsBySessionId.get(this._activeConsoleSessionId)?.value
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
		this._fireActiveConsoleEditorIfChanged();
	}

	// Called when a console's input editor becomes available. The console input mounts (and
	// remounts) independently of the console itself, so this can arrive before or after the
	// console becomes active.
	$addConsoleEditor(sessionId: string, data: ITextEditorAddData): void {
		const uri = URI.revive(data.documentUri);
		const documentData = this._extHostDocumentsAndEditors.getDocument(uri);
		if (!documentData) {
			// The console input model is synchronized before its editor is registered, so this
			// should not happen; bail out rather than hand back an editor with no document.
			this._logService.error(`ExtHostConsoleService: no document for console editor '${uri.toString()}'`);
			return;
		}

		this._consoleEditorsBySessionId.get(sessionId)?.dispose();
		this._consoleEditorsBySessionId.set(sessionId, new ExtHostTextEditor(
			data.id,
			this._editorsProxy,
			this._logService,
			new Lazy(() => documentData.document),
			data.selections.map(typeConverters.Selection.to),
			data.options,
			data.visibleRanges.map(range => typeConverters.Range.to(range)),
			typeof data.editorPosition === 'number' ? typeConverters.ViewColumn.to(data.editorPosition) : undefined
		));

		this._fireActiveConsoleEditorIfChanged();
	}

	// Called when a console's input editor goes away, either because the console was deleted or
	// because the Console view unmounted.
	$removeConsoleEditor(sessionId: string): void {
		const editor = this._consoleEditorsBySessionId.get(sessionId);
		if (!editor) {
			return;
		}
		this._consoleEditorsBySessionId.delete(sessionId);
		editor.dispose();
		this._fireActiveConsoleEditorIfChanged();
	}

	// Called when a console editor's selections, options or visible ranges change. Only the editor
	// state is updated: these deliberately do not raise the core
	// `vscode.window.onDidChangeTextEditor*` events.
	$acceptConsoleEditorPropertiesChanged(sessionId: string, data: IEditorPropertiesChangeData): void {
		const editor = this._consoleEditorsBySessionId.get(sessionId);
		if (!editor) {
			return;
		}
		if (data.options) {
			editor._acceptOptions(data.options);
		}
		if (data.selections) {
			editor._acceptSelections(data.selections.selections.map(typeConverters.Selection.to));
		}
		if (data.visibleRanges) {
			editor._acceptVisibleRanges(coalesce(data.visibleRanges.map(typeConverters.Range.to)));
		}
	}

	/**
	 * Fires `onDidChangeActiveConsoleEditor`, unless the active console editor is the same one
	 * extensions were last told about.
	 */
	private _fireActiveConsoleEditorIfChanged(): void {
		const editor = this.activeConsoleEditor;
		if (editor === this._notifiedActiveConsoleEditor) {
			return;
		}
		this._notifiedActiveConsoleEditor = editor;
		this._onDidChangeActiveConsoleEditor.fire(editor);
	}
}
