/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Channel } from './Channel';
import { CommBackendMessage } from './positron-supervisor';
import { KallichoreSession } from './KallichoreSession';
import { createUniqueId } from './util';
import { JupyterCommMsg } from './jupyter/JupyterCommMsg';
import { CommMsgRequest } from './jupyter/CommMsgRequest';

export class RawCommImpl implements vscode.Disposable {
	readonly receiver: Channel<CommBackendMessage> = new Channel();
	private readonly disposables: vscode.Disposable[] = [];

	constructor(
		private readonly commId: string,
		private readonly session: KallichoreSession,
	) {}

	notify(method: string, params?: Record<string, unknown>) {
		const msg: CommRpcMessage = {
			jsonrpc: '2.0',
			method,
			params,
		};

		// We don't expect a response here, so `id` can be created and forgotten
		const id = createUniqueId();
		this.session.sendClientMessage(this.commId, id, msg);
	}

	async request(method: string, params?: Record<string, unknown>): Promise<any> {
		const id = createUniqueId();

		const msg: CommRpcMessage = {
			jsonrpc: '2.0',
			id,
			method,
			params,
		};

		const commMsg: JupyterCommMsg = {
			comm_id: this.commId,
			data: msg
		};

		const request = new CommMsgRequest(id, commMsg);
		this.session.sendRequest(request);
	}

	dispose() {
		this.receiver.dispose();

		for (const disposable of this.disposables) {
			disposable.dispose();
		}
	}

	register(disposable: vscode.Disposable) {
		this.disposables.push(disposable);
	}
}

export class CommBackendRequest {
	kind: 'request' = 'request';
	readonly method: string;
	readonly params?: Record<string, unknown>;

	private readonly id: string;

	constructor(
		private readonly session: KallichoreSession,
		private readonly commId: string,
		private readonly message: CommRpcMessage,
	) {
		this.method = message.method;
		this.params = message.params;

		if (!this.message.id) {
			throw new Error('Expected `id` field in request');
		}
		this.id = this.message.id;
	}

	reply(result: any) {
		const msg: CommRpcResponse = {
			jsonrpc: '2.0',
			id: this.id,
			method: this.method,
			result,
		};
		this.send(msg);
	}

	reject(error: Error, code = -32000) {
		const msg: CommRpcError = {
			jsonrpc: '2.0',
			id: this.id,
			method: this.method,
			message: `${error}`,
			code,
		};
		this.send(msg);
	}

	private send(data: Record<string, unknown>) {
		const commMsg: JupyterCommMsg = {
			comm_id: this.commId,
			data,
		};
		this.session.sendClientMessage(this.commId, this.id, commMsg);
	}
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

export interface CommRpcError {
	jsonrpc: '2.0';
	message: string;
	code: number;
	id: string;
	[key: string]: unknown;
}
