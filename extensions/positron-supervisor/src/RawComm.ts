/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { KallichoreSession } from './KallichoreSession';
import { createUniqueId } from './util';
import { JupyterCommMsg } from './jupyter/JupyterCommMsg';
import { CommMsgRequest } from './jupyter/CommMsgRequest';

export class RawCommImpl implements vscode.Disposable {
	private readonly disposables: vscode.Disposable[] = [];
	private closed = false;

	constructor(
		private readonly commId: string,
		private readonly session: KallichoreSession,
		private readonly onNotification: (method: string, params?: Record<string, unknown>) => void,
		private readonly onRequest: (method: string, params?: Record<string, unknown>) => any,
	) {}

	notify(method: string, params?: Record<string, unknown>): boolean {
		if (this.closed) {
			return false;
		}

		const msg: CommRpcMessage = {
			jsonrpc: '2.0',
			method,
			params,
		};

		// We don't expect a response here, so `id` can be created and forgotten
		const id = createUniqueId();
		this.session.sendClientMessage(this.commId, id, msg);

		return true;
	}

	async request(method: string, params?: Record<string, unknown>): Promise<[boolean, any]> {
		if (this.closed) {
			return [false, undefined];
		}

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
		return [true, this.session.sendRequest(request)];
	}

	// Relay message from backend to extension
	handleMessage(message: JupyterCommMsg) {
		const data = message.data;
		const rpc = data as CommRpcMessage;
		const isNotification = rpc.id === undefined;

		try {
			if (isNotification) {
				this.onNotification(rpc.method, rpc.params);
			} else {
				const result = this.onRequest(rpc.method, rpc.params);
				this.reply(rpc.id!, rpc.method, result);
			}
		} catch (err) {
			if (isNotification) {
				this.session.log(
					`Notification handler for ${message.comm_id} failed:  ${err}`,
					vscode.LogLevel.Warning
				);
			} else {
				this.reject(rpc.id!, rpc.method, err);
			}
		}
	}

	private reply(id: string, method: string, result: any) {
		const msg: CommRpcResponse = {
			jsonrpc: '2.0',
			id,
			method,
			result,
		};
		this.send(id, msg);
	}

	private reject(id: string, method: string, error: Error, code = -32000) {
		const msg: CommRpcError = {
			jsonrpc: '2.0',
			id,
			method,
			message: `${error}`,
			code,
		};
		this.send(id, msg);
	}

	private send(id: string, data: Record<string, unknown>) {
		const commMsg: JupyterCommMsg = {
			comm_id: this.commId,
			data,
		};
		this.session.sendClientMessage(this.commId, id, commMsg);
	}

	close() {
		this.closed = true;
	}

	dispose() {
		this.close();
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
	}

	register(disposable: vscode.Disposable) {
		this.disposables.push(disposable);
	}
}

interface CommRpcMessage {
	jsonrpc: '2.0';
	method: string;
	// If present, this indicates a request, otherwise a notification.
	// This `id` is otherwise redundant with Jupyter's own `id` field.
	id?: string;
	params?: Record<string, unknown>;
	[key: string]: unknown;
}

interface CommRpcResponse {
	jsonrpc: '2.0';
	result: any;
	id: string;
	[key: string]: unknown;
}

interface CommRpcError {
	jsonrpc: '2.0';
	message: string;
	code: number;
	id: string;
	[key: string]: unknown;
}
