/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { KallichoreSession } from './KallichoreSession';
import { createUniqueId } from './util';
import { JupyterCommMsg } from './jupyter/JupyterCommMsg';
import { CommMsgRequest } from './jupyter/CommMsgRequest';
import { Receiver } from './Channel';
import { CommBackendMessage } from './positron-supervisor';
import { CommCloseCommand } from './jupyter/CommCloseCommand';

export class CommError extends Error {
	constructor(
		message: string,
		public readonly method?: string
	) {
		super(message);
		this.name = 'CommError';
	}
}

export class CommClosedError extends CommError {
	constructor(commId: string, method?: string) {
		super(`Communication channel ${commId} is closed`, method);
		this.name = 'CommClosedError';
	}
}

export class CommRpcError extends CommError {
	constructor(
		message: string,
		public readonly code: number = -32000,
		method?: string
	) {
		super(message, method);
		this.name = 'CommRpcError';
	}
}

export class RawCommImpl implements vscode.Disposable {
	private readonly disposables: vscode.Disposable[] = [];
	private closed = false;

	constructor(
		public readonly id: string,
		private readonly session: KallichoreSession,
		public readonly receiver: Receiver<CommBackendMessage>,
	) { }

	notify(method: string, params?: Record<string, unknown>): void {
		if (this.closed) {
			throw new CommClosedError(this.id, method);
		}

		const msg: CommRpcMessage = {
			jsonrpc: '2.0',
			method,
			params,
		};

		// We don't expect a response here, so `id` can be created and forgotten
		const id = createUniqueId();
		this.session.sendClientMessage(this.id, id, msg);
	}

	async request(method: string, params?: Record<string, unknown>): Promise<any> {
		if (this.closed) {
			throw new CommClosedError(this.id, method);
		}

		const id = createUniqueId();

		const msg: CommRpcMessage = {
			jsonrpc: '2.0',
			id,
			method,
			params,
		};

		const commMsg: JupyterCommMsg = {
			comm_id: this.id,
			data: msg
		};

		const request = new CommMsgRequest(id, commMsg);
		const reply = await this.session.sendRequest(request);

		if (reply.data.error !== undefined) {
			const payload = reply.data as CommRpcMessageError;
			throw new CommRpcError(
				payload.error.message,
				payload.error.code,
				method
			);
		}

		if (reply.data.result === undefined) {
			throw new Error(`Internal error in ${this.id}: undefined result for request ${msg}`);
		}

		return reply.data.result;
	}

	close() {
		this.closed = true;
	}

	closeAndNotify() {
		if (this.closed) {
			return;
		}

		this.close();
		const commClose = new CommCloseCommand(this.id);
		this.session.sendCommand(commClose);
	}

	// Make sure not to call `dispose()` from Kallichore, only the owner of the
	// comm should dispose of it. Kallichore calls the `close()` method instead.
	async dispose(): Promise<void> {
		this.close();
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

	// Handle request. Takes a callback and responds with return value or rejects
	// with error if one is thrown.
	handle(handler: () => any) {
		try {
			this.reply(handler());
		} catch (err) {
			this.reject(err);
		}
	}

	reply(result: any) {
		const msg: CommRpcMessageResult = {
			jsonrpc: '2.0',
			id: this.id,
			method: this.method,
			result,
		};
		this.send(msg);
	}

	reject(error: Error, code = -32000) {
		const msg: CommRpcMessageError = {
			jsonrpc: '2.0',
			id: this.id,
			error: {
				method: this.method,
				message: `${error}`,
				code,
			}
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

interface CommRpcMessageResult {
	jsonrpc: '2.0';
	result: any;
	id: string;
	[key: string]: unknown;
}

interface CommRpcMessageError {
	jsonrpc: '2.0';
	error: {
		message: string;
		code: number;
		[key: string]: unknown;
	};
	id: string;
	[key: string]: unknown;
}
