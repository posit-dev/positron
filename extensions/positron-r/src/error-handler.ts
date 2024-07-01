/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Keep in sync with positron-python's `errorHandler.ts`

import {
	CloseAction,
	CloseHandlerResult,
	ErrorAction,
	ErrorHandler,
	ErrorHandlerResult,
	Message
} from 'vscode-languageclient/node';

import { LOGGER } from './extension';

// The `DefaultErrorHandler` adds restarts on close, which we don't want. We want to be fully in
// control over restarting the client side of the LSP, both because we have our own runtime restart
// behavior, and because we have state that relies on client status changes being accurate (i.e.
// in `this._client.onDidChangeState()`). Additionally, we set `handled: true` to avoid a toast
// notification that is inactionable from the user's point of view.
// https://github.com/posit-dev/positron/pull/2880
// https://github.com/microsoft/vscode-languageserver-node/blob/8e625564b531da607859b8cb982abb7cdb2fbe2e/client/src/common/client.ts#L420
// https://github.com/microsoft/vscode-languageserver-node/blob/8e625564b531da607859b8cb982abb7cdb2fbe2e/client/src/common/client.ts#L1617
// https://github.com/microsoft/vscode-languageserver-node/blob/4b5f9cf622963dcfbc6129cdc1a570e2bb9f66a4/client/src/common/client.ts#L1639
export class RErrorHandler implements ErrorHandler {
	constructor(
		private readonly _version: string,
		private readonly _port: number
	) {
	}

	public error(error: Error, _message: Message, count: number): ErrorHandlerResult {
		LOGGER.warn(`ARK (R ${this._version}) language client error occurred (port ${this._port}). '${error.name}' with message: ${error.message}. This is error number ${count}.`);
		return { action: ErrorAction.Shutdown, handled: true };
	}

	public closed(): CloseHandlerResult {
		LOGGER.warn(`ARK (R ${this._version}) language client was closed unexpectedly (port ${this._port}).`);
		return { action: CloseAction.DoNotRestart, handled: true };
	}
}
