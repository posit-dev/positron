/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableMap, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';

/**
 * Tracks which console input, if any, was the most recently focused text editor.
 *
 * This answers "should the console be treated as the active document, and whose console?" for the
 * rstudioapi editor context shim (see `ExtHostMethods.lastActiveEditorContext()`), and mirrors how
 * RStudio decides the same question. RStudio records the id of the last Ace editor to fire a focus
 * event and reports the console whenever that id is the console input's.
 *
 * Two properties matter, and both are load-bearing:
 *
 * - **It is sticky, not live.** Selecting text in the console output, or clicking into the
 *   Variables pane, blurs the console input without any editor taking focus. A live "is the
 *   console focused now" check would hand those cases to the last active editor pane even though
 *   the user never went near it.
 * - **It records which console, not just that one was focused.** The caller has to be compared
 *   against the console the user actually focused, because the active console is not a usable
 *   stand-in: `PositronConsoleService.executeCode` activates the target console before the code
 *   runs (even with `focus: false`), so by the time a kernel's RPC arrives the active console is
 *   always the caller's own. Comparing against it would let a click on the Python console
 *   authorize returning the R console.
 */
export class ConsoleInputFocusTracker extends Disposable {

	/** The session whose console input was focused last, or `undefined` for a source editor. */
	private _lastFocusedConsoleSessionId: string | undefined;

	/** Session id for each registered console input editor. */
	private readonly _consoleInputs = new Map<ICodeEditor, string>();

	/** The focus listener for each live code editor. */
	private readonly _editorListeners = this._register(new DisposableMap<ICodeEditor>());

	constructor(
		@ICodeEditorService codeEditorService: ICodeEditorService,
	) {
		super();

		// Console inputs are code editors like any other, so one subscription per editor covers
		// both sides of the comparison.
		for (const editor of codeEditorService.listCodeEditors()) {
			this._trackEditor(editor);
		}
		this._register(codeEditorService.onCodeEditorAdd(editor => this._trackEditor(editor)));
		this._register(codeEditorService.onCodeEditorRemove(
			editor => this._editorListeners.deleteAndDispose(editor)));
	}

	/**
	 * The session whose console input was the most recently focused text editor, or `undefined`
	 * when a source editor was focused more recently than any console input.
	 */
	get lastFocusedConsoleSessionId(): string | undefined {
		return this._lastFocusedConsoleSessionId;
	}

	/**
	 * Registers a console's input editor. Returns a disposable that unregisters it again; after
	 * that the editor counts as an ordinary editor rather than a console input.
	 */
	trackConsoleInput(sessionId: string, editor: ICodeEditor): IDisposable {
		this._consoleInputs.set(editor, sessionId);

		// Seed from the editor's current state, because a focus event only reports a *change*.
		// This tracker is rebuilt whenever the extension host restarts (`MainThreadConsoleService`
		// is a per-extension-host customer) while the workbench keeps running, so the console
		// input can already hold focus by the time it is registered here. A source editor holding
		// focus needs no equivalent seed: `undefined` already means "a source editor was focused
		// last".
		//
		// This does mean a restart loses the sticky answer when the console was focused last but
		// focus has since moved somewhere that is not an editor (the Variables pane, a selection
		// in the console output): there is no focus state left to read. The next console focus
		// re-establishes it, and until then the caller gets the editor pane, which is what
		// Positron did before consoles were considered at all. Surviving that would mean giving
		// this tracker a workbench lifetime rather than an extension-host one.
		if (editor.hasTextFocus()) {
			this._lastFocusedConsoleSessionId = sessionId;
		}

		return toDisposable(() => this._consoleInputs.delete(editor));
	}

	private _trackEditor(editor: ICodeEditor): void {
		this._editorListeners.set(
			editor,
			editor.onDidFocusEditorText(() => this._onEditorFocused(editor)));
	}

	private _onEditorFocused(editor: ICodeEditor): void {
		// Resolved at focus time, not registration time: a console's code editor is registered
		// with `ICodeEditorService` during construction, before the console instance's editor is
		// handed to `trackConsoleInput`.
		const sessionId = this._consoleInputs.get(editor);
		if (sessionId !== undefined) {
			this._lastFocusedConsoleSessionId = sessionId;
		} else if (!editor.isSimpleWidget) {
			// Simple widgets are text inputs that happen to be code editors: find boxes, the SCM
			// commit message, the settings search. Focusing one is not the user moving to a
			// source document, so it leaves the answer alone.
			this._lastFocusedConsoleSessionId = undefined;
		}
	}
}
