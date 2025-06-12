/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Channel } from './Channel';

export type CommBackendMessage =
	| {
		kind: 'request';
		method: string;
		params?: Record<string, unknown>;
		reply: (result: any) => void;
	}
	| {
		kind: 'notification';
		method: string;
		params?: Record<string, unknown>;
	};

export type CommBackendChannel = Channel<CommBackendMessage>;

export interface RawComm {
	receiver: CommBackendChannel;
	notify: (method: string, params?: Record<string, unknown>) => void;
	request: (method: string, params?: Record<string, unknown>) => Promise<any>;
}

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
