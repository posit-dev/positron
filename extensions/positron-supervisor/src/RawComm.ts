/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Channel } from './Channel';

/**
 * Raw comm unmanaged by Positron.
 *
 * This type of comm is not mapped to a Positron client. It lives entirely in
 * the extension space and allows private communication between an extension and
 * its kernel.
 */
export interface RawComm {
	/** Async-iterable for messages sent from backend. */
	receiver: Channel<CommBackendMessage>;

	/** Send a notification to the backend comm. */
	notify: (method: string, params?: Record<string, unknown>) => void;

	/** Make a request to the backend comm. Resolves when backend responds. */
	request: (method: string, params?: Record<string, unknown>) => Promise<any>;

	/** Clear resources and sends `comm_close` to backend comm (unless the channel
	  * was closed by the backend already). */
	dispose: () => void;
}

/** Message from the backend.
 *
 * If a request, one of the `reply` or `reject` method must be called.
 */
export type CommBackendMessage =
	| {
		kind: 'request';
		method: string;
		params?: Record<string, unknown>;
		reply: (result: any) => void;
		reject: (error: Error) => void;
	}
	| {
		kind: 'notification';
		method: string;
		params?: Record<string, unknown>;
	};

export interface CommRpcMessage {
	jsonrpc: '2.0';
	method: string;
	// If present, this indicates a request, otherwise a notification.
	// This `id` is otherwise redundant with Jupyter's own `id` field.
	id?: string;
	params?: Record<string, unknown>;
	[key: string]: unknown;
}

export interface CommRpcResponse {
	jsonrpc: '2.0';
	result: any;
	id: string;
	[key: string]: unknown;
}

export interface CommRpcError {
	jsonrpc: '2.0';
	message: string;
	code: number;
	id: string;
	[key: string]: unknown;
}
