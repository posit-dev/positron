/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import type { WebviewMessage } from '../src/providerDemoProtocol';

interface VsCodeApi {
	postMessage(message: WebviewMessage): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

/**
 * The host handle, acquired once.
 *
 * `acquireVsCodeApi` throws if called more than once per webview, so it must not
 * live inside a component body where a re-render or a Strict Mode double-invoke
 * would call it again.
 */
export const vscodeApi: VsCodeApi = acquireVsCodeApi();
