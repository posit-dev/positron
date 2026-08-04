/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Lazy } from '../../../../base/common/lazy.js';
import { DisposableMap, DisposableStore, IDisposable, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { ExtHostConsoleServiceShape, ExtHostPositronContext, IMainThreadHiddenEditorManager, MainPositronContext, MainThreadConsoleServiceShape } from '../../common/positron/extHost.positron.protocol.js';
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

	/**
	 * Console input editor tracking, keyed by session id. Each entry owns the current editor
	 * registration plus the subscription that re-registers it when the Console view remounts, and
	 * is disposed when the console is deleted.
	 */
	private readonly _consoleEditorTracking = this._disposables.add(new DisposableMap<string>());

	private readonly _proxy: ExtHostConsoleServiceShape;

	/**
	 * Lets us register the console input editor with the extension host without it entering the
	 * core documents-and-editors state.
	 *
	 * Resolved lazily, on first registration: the actor is set by `MainThreadDocumentsAndEditors`,
	 * a plain `@extHostCustomer`, and those are constructed after the named customers this class is
	 * one of (`ExtensionHostManager._createExtensionHostCustomers`). Resolving it in the constructor
	 * would throw (`RPCProtocol.getRaw` requires the actor to be set), and the thrown error is
	 * swallowed by the customer loop -- taking this service's whole RPC channel down with it.
	 */
	private readonly _hiddenEditorManager: Lazy<IMainThreadHiddenEditorManager>;

	constructor(
		extHostContext: IExtHostContext,
		@IPositronConsoleService private readonly _positronConsoleService: IPositronConsoleService
	) {
		// Create the proxy for the extension host.
		this._proxy = extHostContext.getProxy(ExtHostPositronContext.ExtHostConsoleService);

		this._hiddenEditorManager = new Lazy(() =>
			extHostContext.getRaw<IMainThreadHiddenEditorManager, IMainThreadHiddenEditorManager>(
				MainPositronContext.MainThreadHiddenEditorManager
			));

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
				this._addConsole(console);
			})
		);

		// Retire the console's editor registration when the console goes away, so the extension
		// host cannot keep handing out a `TextEditor` for a disposed console.
		this._disposables.add(
			this._positronConsoleService.onDidDeletePositronConsoleInstance((console) => {
				this._consoleEditorTracking.deleteAndDispose(console.sessionMetadata.sessionId);
			})
		);

		// Forward active console changes to the extension host
		this._disposables.add(
			this._positronConsoleService.onDidChangeActivePositronConsoleInstance((instance) => {
				this._proxy.$onDidChangeActiveConsole(instance?.sessionId);
			})
		);

		this._replayExistingConsoles();

		// TODO:
		// As of right now, we never delete console instances from the maps in
		// `MainThreadConsoleService` and `ExtHostConsoleService` because we don't have a hook to
		// know when a console is stopped. In particular, we should really call the `ExtHostConsole`
		// `dispose()` method, which will ensure that any API callers who use the corresponding
		// `Console` object will get a warning / error when calling the API of a closed console.
		// (Note that the console's *editor* registration is cleaned up on
		// `onDidDeletePositronConsoleInstance` above; it is the `Console` object that outlives it.)
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
	}

	/**
	 * Announces the consoles that already exist to the extension host. This service is recreated
	 * whenever the extension host restarts, and consoles started before that never re-fire
	 * `onDidStartPositronConsoleInstance`, so without this the extension host would never learn
	 * about a console that is already running.
	 *
	 * Deferred to a microtask, i.e. until after every extension host customer has been constructed.
	 * The console input's *document* only reaches the extension host in the first
	 * `$acceptDocumentsAndEditorsDelta`, which `MainThreadDocumentsAndEditors` sends from its own
	 * constructor -- and being a plain `@extHostCustomer` it is constructed after named customers
	 * like this one. Replaying during construction would put `$addConsoleEditor` ahead of that delta
	 * on the wire, and the extension host drops an editor whose document it does not have yet.
	 */
	private _replayExistingConsoles(): void {
		queueMicrotask(() => {
			if (this._disposables.isDisposed) {
				return;
			}

			for (const instance of this._positronConsoleService.positronConsoleInstances) {
				if (this._mainThreadConsolesBySessionId.has(instance.sessionMetadata.sessionId)) {
					// Started while the replay was pending, so
					// `onDidStartPositronConsoleInstance` already announced it.
					continue;
				}
				this._addConsole(instance);
			}

			const activeInstance = this._positronConsoleService.activePositronConsoleInstance;
			if (activeInstance) {
				this._proxy.$onDidChangeActiveConsole(activeInstance.sessionId);
			}
		});
	}

	private _addConsole(instance: IPositronConsoleInstance): void {
		const sessionId = instance.sessionMetadata.sessionId;

		// First update ext host
		this._proxy.$addConsole(sessionId);

		// Then update main thread
		this._mainThreadConsolesBySessionId.set(sessionId, new MainThreadConsole(instance));

		// Finally, expose the console's Monaco editor to extensions so they can reach it via
		// `positron.window.activeConsoleEditor`.
		this._trackConsoleEditor(instance);
	}

	// TODO:
	// See comment in constructor
	//
	// private removeConsole(id: string) {
	// 	// No dispose() method to call
	// 	this._mainThreadConsolesByLanguageId.delete(id);
	// }

	/**
	 * Keeps the extension host's view of `instance`'s input editor up to date for the lifetime of
	 * the console.
	 *
	 * The Console view can remount -- moving the pane, or recreating it, builds a fresh Monaco
	 * editor and text model -- so we stay subscribed to `onDidSetCodeEditor` and replace the
	 * registration each time rather than registering only the first editor.
	 */
	private _trackConsoleEditor(instance: IPositronConsoleInstance): void {
		const sessionId = instance.sessionMetadata.sessionId;

		// Retire any tracking left over from a previous session with this id *before* building its
		// replacement, for the same reason as `replaceRegistration` below.
		this._consoleEditorTracking.deleteAndDispose(sessionId);

		const tracking = new DisposableStore();

		// Holds the registration for the console's current code editor.
		const registration = tracking.add(new MutableDisposable<IDisposable>());

		// Retires the previous registration before creating its replacement. Every registration for
		// this console uses the editor id `console-<sessionId>`, and both the main thread's editor
		// map and the extension host's console editor map are keyed by it, so disposing the old
		// registration *after* the new one exists would retire the new editor instead of the old.
		const replaceRegistration = (codeEditor: ICodeEditor) => {
			registration.clear();
			registration.value = this._registerConsoleEditor(sessionId, codeEditor);
		};

		tracking.add(instance.onDidSetCodeEditor(replaceRegistration));

		if (instance.codeEditor) {
			// The editor is already mounted, so `onDidSetCodeEditor` has already fired for it.
			replaceRegistration(instance.codeEditor);
		}

		this._consoleEditorTracking.set(sessionId, tracking);
	}

	/**
	 * Registers a single console input editor with the extension host, and returns a disposable
	 * that retires it again.
	 */
	private _registerConsoleEditor(sessionId: string, codeEditor: ICodeEditor): IDisposable {
		const store = new DisposableStore();
		const editorId = `console-${sessionId}`;

		const doRegister = (model: ITextModel) => {
			const registration = store.add(this._hiddenEditorManager.value.registerHiddenTextEditor(editorId, codeEditor, model));

			// The editor travels over the Positron-only console channel, never through
			// `$acceptDocumentsAndEditorsDelta`, so it stays out of `visibleTextEditors` and the
			// core editor events (posit-dev/positron#780).
			this._proxy.$addConsoleEditor(sessionId, registration.addData);
			store.add(registration.onPropertiesChanged((data) => {
				this._proxy.$acceptConsoleEditorPropertiesChanged(sessionId, data);
			}));

			// Added last so it is disposed last: the extension host is told to forget the editor
			// only after the main thread has stopped producing state for it.
			store.add(toDisposable(() => this._proxy.$removeConsoleEditor(sessionId)));
		};

		// Unmounting the Console view disposes the editor without clearing
		// `IPositronConsoleInstance.codeEditor`, so retire the registration here rather than let
		// the extension host keep resolving a disposed editor until a new one mounts.
		store.add(codeEditor.onDidDispose(() => store.dispose()));

		const model = codeEditor.getModel();
		if (model) {
			doRegister(model);
		} else {
			// The console input assigns its code editor before attaching the text model. Wait for
			// the model rather than skipping registration, otherwise the editor would never be
			// resolvable through `positron.window.activeConsoleEditor`.
			const modelListener = store.add(codeEditor.onDidChangeModel(() => {
				const newModel = codeEditor.getModel();
				if (newModel) {
					modelListener.dispose();
					doRegister(newModel);
				}
			}));
		}

		return store;
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
