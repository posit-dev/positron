/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { IRuntimeClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeClientInstance';
import { Event, Emitter } from 'vs/base/common/event';

/**
 * An enum representing the set of JSON-RPC error codes.
 */
export enum JsonRpcErrorCode {
	ParseError = -32700,
	InvalidRequest = -32600,
	MethodNotFound = -32601,
	InvalidParams = -32602,
	InternalError = -32603,
	ServerErrorStart = -32000,
	ServerErrorEnd = -32099
}

/**
 * An error returned by a runtime method call.
 */
export interface PositronCommError {
	/** An error code */
	code: JsonRpcErrorCode;

	/** A human-readable error message */
	message: string;

	/**
	 * A name for the error, for compatibility with the Error object.
	 * Usually `RPC Error ${code}`.
	 */
	name: string;

	/** Additional error information (optional) */
	data: any | undefined;
}

export class PositronBaseComm {
	private _emitters = new Map<string, Emitter<any>>();
	constructor(private readonly clientInstance: IRuntimeClientInstance<any, any>) {
		clientInstance.onDidReceiveData((data) => {
			const emitter = this._emitters.get(data.method);
			if (emitter) {
				emitter.fire(data);
			}
		});
	}

	protected createEventEmitter<T>(): Event<T> | undefined {
		return undefined;
	}

	protected async performRpc<T>(rpcName: string, ...rpcArgs: any[]): Promise<T> {
		// Form the request object
		const request = {
			jsonrpc: '2.0',
			method: rpcName,
			params: rpcArgs
		};

		// Perform the RPC
		let response = {} as any;
		try {
			response = await this.clientInstance.performRpc(request);
		} catch (err) {
			// Convert the error to a runtime method error. This handles errors
			// that occur while performing the RPC; if the RPC is successfully
			// sent and a response received, errors named in the response are
			// handled below.
			const error: PositronCommError = {
				code: JsonRpcErrorCode.InternalError,
				message: err.message,
				name: err.name,
				data: err, // Wrap the underlying error in a data object
			};
			throw error;
		}

		// If the response is an error, throw it
		if (Object.keys(response).includes('error')) {
			const error = response.error;

			// Populate the error object with the name of the error code
			// for conformity with code that expects an Error object.
			error.name = `RPC Error ${response.error.code}`;

			throw error;
		}

		// JSON-RPC specifies that the return value must have either a 'result'
		// or an 'error'; make sure we got a result before we pass it back.
		if (!Object.keys(response).includes('result')) {
			const error: PositronCommError = {
				code: JsonRpcErrorCode.InternalError,
				message: `Invalid response from ${this.clientInstance.getClientId()}: ` +
					`no 'result' field. ` +
					`(response = ${JSON.stringify(response)})`,
				name: `InvalidResponseError`,
				data: {},
			};

			throw error;
		}

		// Otherwise, return the result
		return response.result;
	}
}
