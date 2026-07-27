/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore, IDisposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { ExtHostConsoleServiceShape, ExtHostPositronContext, IMainThreadConsoleEditorManager, MainPositronContext, MainThreadConsoleServiceShape } from '../../common/positron/extHost.positron.protocol.js';
import { extHostNamedCustomer, IExtHostContext } from '../../../services/extensions/common/extHostCustomers.js';
import { IPositronConsoleInstance, IPositronConsoleService } from '../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { MainThreadConsole } from './mainThreadConsole.js';

@extHostNamedCustomer(MainPositronContext.MainThreadConsoleService)
export class MainThreadConsoleService implements MainThreadConsoleServiceShape {

	private readonly _disposables = new DisposableStore();

	/**
	 * A Map of session ids to the respective console.
	 * Each session id maps to a single console.
	 * Multiple sessions could map to the same console, this happens
	 * when a user power-cycles the session for a console instance
	 * (i.e. shutdown session for console instance, then start a session for console instance)
	 *
	 * Kept in sync with consoles in `ExtHostConsoleService`
	 */
	private readonly _mainThreadConsolesBySessionId = new Map<string, MainThreadConsole>();

	/** Disposables for registered console text editors, keyed by session id. */
	private readonly _consoleEditorDisposables = new Map<string, MutableDisposable<IDisposable>>();

	private readonly _proxy: ExtHostConsoleServiceShape;

	constructor(
		extHostContext: IExtHostContext,
		@IPositronConsoleService private readonly _positronConsoleService: IPositronConsoleService
	) {
		// Create the proxy for the extension host.
		this._proxy = extHostContext.getProxy(ExtHostPositronContext.ExtHostConsoleService);

		// Register to be notified of changes to the console width; when they are
		// received, forward them to the extension host so extensions can be
		// notified.
		this._disposables.add(
			this._positronConsoleService.onDidChangeConsoleWidth((newWidth) => {
				this._proxy.$onDidChangeConsoleWidth(newWidth);
			}));

		// Forward new positron console session id to the extension host, and then register it
		// in the main thread too
		this._disposables.add(
			this._positronConsoleService.onDidStartPositronConsoleInstance((console) => {
				const sessionId = console.sessionMetadata.sessionId;

				// First update ext host
				this._proxy.$addConsole(sessionId);

				// Then update main thread
				this.addConsole(sessionId, console);

				// Register the console's Monaco editor with the text editor tracking so
				// extensions can access it via positron.window.activeConsoleEditor.
				const manager = extHostContext.getRaw<IMainThreadConsoleEditorManager, IMainThreadConsoleEditorManager>(
					MainPositronContext.MainThreadConsoleEditorManager
				);
				this._registerConsoleEditor(console, manager);
			})
		);

		// Forward active console changes to the extension host
		this._disposables.add(
			this._positronConsoleService.onDidChangeActivePositronConsoleInstance((instance) => {
				this._proxy.$onDidChangeActiveConsole(instance?.sessionId);
				this._notifyActiveConsoleEditor(instance);
			})
		);

		// TODO:
		// As of right now, we never delete console instances from the maps in
		// `MainThreadConsoleService` and `ExtHostConsoleService` because we don't have a hook to
		// know when a console is stopped. In particular, we should really call the `ExtHostConsole`
		// `dispose()` method, which will ensure that any API callers who use the corresponding
		// `Console` object will get a warning / error when calling the API of a closed console.
		//
		// this._disposables.add(
		// 	this._positronConsoleService.onDidRemovePositronConsoleInstance((console) => {
		// 		const sessionId = console.session.sessionId;
		//
		// 		// First update ext host
		// 		this._proxy.$removeConsole(sessionId);
		//
		// 		// Then update main thread
		// 		this.removeConsole(sessionId);
		// 	})
		// )
	}

	dispose(): void {
		this._disposables.dispose();
		for (const d of this._consoleEditorDisposables.values()) {
			d.dispose();
		}
	}

	private addConsole(sessionId: string, console: IPositronConsoleInstance) {
		const mainThreadConsole = new MainThreadConsole(console);
		this._mainThreadConsolesBySessionId.set(sessionId, mainThreadConsole);
	}

	// TODO:
	// See comment in constructor
	//
	// private removeConsole(id: string) {
	// 	// No dispose() method to call
	// 	this._mainThreadConsolesByLanguageId.delete(id);
	// }

	/**
	 * Registers the Monaco editor for `instance` with the text editor tracking pipeline so
	 * that extensions can use `positron.window.activeConsoleEditor` to access a full
	 * `vscode.TextEditor` for the console input.
	 *
	 * The editor is intentionally NOT set as `vscode.window.activeTextEditor`.
	 */
	private _registerConsoleEditor(instance: IPositronConsoleInstance, manager: IMainThreadConsoleEditorManager): void {
		const sessionId = instance.sessionMetadata.sessionId;
		const editorId = `console-${sessionId}`;

		const doRegister = () => {
			const mutable = new MutableDisposable<IDisposable>();
			this._consoleEditorDisposables.set(sessionId, mutable);
			this._disposables.add(mutable);
			mutable.value = manager.registerConsoleEditor(editorId, instance.codeEditor!);
		};

		if (instance.codeEditor) {
			// Editor already mounted — register immediately.
			doRegister();
		} else {
			// Editor not yet mounted (React component hasn't mounted yet).
			// Wait for the first assignment.
			const sub = instance.onDidSetCodeEditor(() => {
				sub.dispose();
				doRegister();

				// If this instance is already the active console, notify now.
				if (this._positronConsoleService.activePositronConsoleInstance === instance) {
					this._proxy.$setActiveConsoleEditor(editorId);
				}
			});
			this._disposables.add(sub);
		}
	}

	/**
	 * Notifies the extension host of the active console editor id so
	 * `positron.window.activeConsoleEditor` can be updated.
	 */
	private _notifyActiveConsoleEditor(instance: IPositronConsoleInstance | undefined): void {
		if (!instance) {
			this._proxy.$setActiveConsoleEditor(null);
			return;
		}
		const sessionId = instance.sessionMetadata.sessionId;
		const editorId = `console-${sessionId}`;
		// Only notify if the editor has been registered (codeEditor is set).
		if (instance.codeEditor && this._consoleEditorDisposables.has(sessionId)) {
			this._proxy.$setActiveConsoleEditor(editorId);
		}
		// If codeEditor isn't set yet, _registerConsoleEditor will notify once it mounts.
	}

	// --- from extension host process

	$getConsoleWidth(): Promise<number> {
		return Promise.resolve(this._positronConsoleService.getConsoleWidth());
	}

	/**
	 * Get the session id of the active console for a particular language id
	 *
	 * @param languageId The language id to find a session id for.
	 */
	$getSessionIdForLanguage(languageId: string): Promise<string | undefined> {
		// TODO: This is wrong in a multi-session world. It finds the
		// first matching `languageId` in the map, but we likely want the "most
		// recently activated and still alive" one. Reprex to prove it is wrong,
		// which should eventually become a test:
		// - Start R console 1
		// - Start R console 2
		// - Run `cli::cli_alert("{.run revdepcheck::cloud_summary()}")` in R
		//   console 2 and click the hyperlink.
		// - The pasted code will incorrectly end up in R console 1.

		for (let [sessionId, console] of this._mainThreadConsolesBySessionId.entries()) {
			if (console.getLanguageId() === languageId) {
				return Promise.resolve(sessionId);
			}
		}

		return Promise.resolve(undefined);
	}

	$getActiveConsoleSessionId(): Promise<string | undefined> {
		return Promise.resolve(this._positronConsoleService.activePositronConsoleInstance?.sessionId);
	}

	$tryPasteText(sessionId: string, text: string): void {
		const mainThreadConsole = this._mainThreadConsolesBySessionId.get(sessionId);

		if (!mainThreadConsole) {
			return;
		}

		mainThreadConsole.pasteText(text);
	}
}
