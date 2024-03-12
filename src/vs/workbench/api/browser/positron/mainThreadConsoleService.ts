/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore } from 'vs/base/common/lifecycle';
import { ExtHostConsoleServiceShape, ExtHostPositronContext, MainPositronContext, MainThreadConsoleServiceShape } from '../../common/positron/extHost.positron.protocol';
import { extHostNamedCustomer, IExtHostContext } from 'vs/workbench/services/extensions/common/extHostCustomers';
import { IPositronConsoleInstance, IPositronConsoleService } from 'vs/workbench/services/positronConsole/browser/interfaces/positronConsoleService';
import { MainThreadConsole } from 'vs/workbench/api/browser/positron/mainThreadConsole';

@extHostNamedCustomer(MainPositronContext.MainThreadConsoleService)
export class MainThreadConsoleService implements MainThreadConsoleServiceShape {

	private readonly _disposables = new DisposableStore();

	// Map of language `id` to console.
	// Assumes each language `id` maps to at most 1 console,
	// which may need to be relaxed in the future.
	// Kept in sync with consoles in `ExtHostConsoleService`.
	private readonly _mainThreadConsolesByLanguageId = new Map<string, MainThreadConsole>();

	private readonly _proxy: ExtHostConsoleServiceShape;

	constructor(
		extHostContext: IExtHostContext,
		@IPositronConsoleService private readonly _positronConsoleService: IPositronConsoleService,
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

		// Forward new positron console language id to the extension host, and then register it
		// in the main thread too
		this._disposables.add(
			this._positronConsoleService.onDidStartPositronConsoleInstance((console) => {
				const id = console.session.runtimeMetadata.languageId;

				// First update ext host
				this._proxy.$addConsole(id);

				// Then update main thread
				this.addConsole(id, console);
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
		// 		const id = console.runtime.metadata.languageId;
		//
		// 		// First update ext host
		// 		this._proxy.$removeConsole(id);
		//
		// 		// Then update main thread
		// 		this.removeConsole(id);
		// 	})
		// )
	}

	dispose(): void {
		this._disposables.dispose();
	}

	private getConsoleForLanguage(id: string): MainThreadConsole | undefined {
		return this._mainThreadConsolesByLanguageId.get(id);
	}

	private addConsole(id: string, console: IPositronConsoleInstance) {
		const mainThreadConsole = new MainThreadConsole(console);
		this._mainThreadConsolesByLanguageId.set(id, mainThreadConsole);
	}

	// TODO:
	// See comment in constructor
	//
	// private removeConsole(id: string) {
	// 	// No dispose() method to call
	// 	this._mainThreadConsolesByLanguageId.delete(id);
	// }

	// --- from extension host process

	$getConsoleWidth(): Promise<number> {
		return Promise.resolve(this._positronConsoleService.getConsoleWidth());
	}

	$tryPasteText(id: string, text: string): void {
		const mainThreadConsole = this.getConsoleForLanguage(id);

		if (!mainThreadConsole) {
			return;
		}

		mainThreadConsole.pasteText(text);
	}
}
