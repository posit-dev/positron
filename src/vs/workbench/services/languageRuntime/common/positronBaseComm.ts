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

/**
 * An event emitter that can be used to fire events from the backend to the
 * frontend.
 */
class PositronCommEmitter<T> extends Emitter<T> {
	/**
	 * Create a new event emitter.
	 *
	 * @param name The name of the event, as a JSON-RPC method name.
	 * @param properties The names of the properties in the event payload; used
	 *   to convert positional parameters to named parameters.
	 */
	constructor(readonly name: string, readonly properties: string[]) {
		super();
	}
}

/**
 * A base class for Positron comm instances. This class handles communication
 * with the backend, and provides methods for creating event emitters and
 * performing RPCs.
 *
 * Used by generated comm classes.
 */
export class PositronBaseComm {
	/**
	 * A map of event names to emitters. This is used to create event emitters
	 * from the backend to the frontend.
	 */
	private _emitters = new Map<string, PositronCommEmitter<any>>();

	/**
	 * Create a new Positron com
	 *
	 * @param clientInstance The client instance to use for communication with the backend.
	 *  This instance must be connected to the backend before it is passed to this class.
	 */
	constructor(private readonly clientInstance: IRuntimeClientInstance<any, any>) {
		clientInstance.onDidReceiveData((data) => {
			const emitter = this._emitters.get(data.method);
			if (emitter) {
				const payload = data.params;
				// JSON-RPC parameters can be specified either as an array or as
				// key/value pairs. If the payload is an array, convert it to
				// the object form.
				if (Array.isArray(payload)) {
					// Create the object from the array, converting positional
					// parameters to named parameters.
					const obj: any = {};
					for (let i = 0; i < payload.length; i++) {
						obj[emitter.properties[i]] = payload[i];
					}
					emitter.fire(obj);
				} else if (typeof payload === 'object') {
					// If the payload is already an object, just fire the event
					emitter.fire(payload);
				} else {
					// If the payload is some other kind of object, log a
					// warning; we can't fire an event with it.
					console.warn(`Invalid payload type ${typeof payload} ` +
						`for event '${data.method}' ` +
						`on comm ${this.clientInstance.getClientId()}: ` +
						`${JSON.stringify(payload)} ` +
						`(Expected an object or an array)`);
				}
			}
		});
	}

	/**
	 * Create a new event emitter.
	 * @param name The name of the event, as a JSON-RPC method name.
	 * @param properties The names of the properties in the event payload; used
	 *  to convert positional parameters to named parameters.
	 * @returns
	 */
	protected createEventEmitter<T>(name: string, properties: string[]): Event<T> | undefined {
		const emitter = new PositronCommEmitter<T>(name, properties);
		return emitter.event;
	}

	/**
	 * Perform an RPC and wait for the result.
	 *
	 * @param rpcName The name of the RPC to perform.
	 * @param rpcArgs The arguments to the RPC.
	 * @returns A promise that resolves to the result of the RPC, or rejects
	 *  with a PositronCommError.
	 */
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
