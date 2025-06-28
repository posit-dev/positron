/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { ExtHostConsoleServiceShape, ExtHostPositronContext, MainPositronContext, MainThreadConsoleServiceShape } from '../../common/positron/extHost.positron.protocol.js';
import { extHostNamedCustomer, IExtHostContext } from '../../../services/extensions/common/extHostCustomers.js';
import { IPositronConsoleInstance, IPositronConsoleService } from '../../../services/positronConsole/browser/interfaces/positronConsoleService.js';

@extHostNamedCustomer(MainPositronContext.MainThreadConsoleService)
export class MainThreadConsoleService implements MainThreadConsoleServiceShape {

	private readonly _disposables = new DisposableStore();

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

		// Forward new positron console session id to the extension host
		this._disposables.add(
			this._positronConsoleService.onDidStartPositronConsoleInstance((console) => {
				this._proxy.$onDidStartPositronConsoleInstance(console.sessionMetadata.sessionId);
			})
		);

		// Forward deleted positron console session id to the extension host
		this._disposables.add(
			this._positronConsoleService.onDidDeletePositronConsoleInstance((console) => {
				this._proxy.$onDidDeletePositronConsoleInstance(console.sessionMetadata.sessionId);
			})
		)
	}

	dispose(): void {
		this._disposables.dispose();
	}

	private getConsoleForSessionId(sessionId: string): IPositronConsoleInstance | undefined {
		return this._positronConsoleService.positronConsoleInstances.find((console) => console.sessionMetadata.sessionId === sessionId);
	}

	// --- from extension host process

	$getConsoleWidth(): Promise<number> {
		return Promise.resolve(this._positronConsoleService.getConsoleWidth());
	}

	$pasteText(sessionId: string, text: string): void {
		const console = this.getConsoleForSessionId(sessionId);

		if (!console) {
			return;
		}

		console.pasteText(text);
	}
}
