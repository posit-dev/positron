/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// This is a copy of PositronBaseCommm.ts adapted to work on the extensions land.
// It mainly ports the logic that is used to check argument types and prepare and RPC request
// to the backend as well as the logic to handle errors returned by the backend.

import * as positron from 'positron';
import { Disposable, Event } from 'vscode';
import { randomUUID } from 'crypto';

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
	ServerErrorEnd = -32099,
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
class PositronCommEmitter<T> {
	private _event?: Event<T>;
	private _listeners: Record<string, (data: T) => void> = {};
	/**
	 * Create a new event emitter.
	 *
	 * @param name The name of the event, as a JSON-RPC method name.
	 * @param properties The names of the properties in the event payload; used
	 *   to convert positional parameters to named parameters.
	 */
	constructor(readonly name: string, readonly properties: string[]) {
		this.name = name;
		this.properties = properties;
	}

	get event(): Event<T> {
		if (!this._event) {
			this._event = (listener: (data: T) => void, thisArgs?, disposables?) => {
				if (disposables) {
					throw new Error('Disposables are not supported');
				}

				if (thisArgs) {
					throw new Error('thisArgs is not supported');
				}

				const uuid = randomUUID();
				this._listeners[uuid] = listener;
				return new Disposable(() => {
					delete this._listeners[uuid];
				});
			};
		}
		return this._event;
	}

	fire(data: T) {
		Object.values(this._listeners).map((listener) => listener(data));
	}

	dispose() {
		this._listeners = {};
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
	 * Create a new Positron com
	 *
	 * @param clientInstance The client instance to use for communication with the backend.
	 *  This instance must be connected to the backend before it is passed to this class.
	 */

	private _disposables: Disposable[] = [];

	constructor(
		private readonly clientInstance: positron.RuntimeClientInstance
	) { }

	/**
	 * Perform an RPC and wait for the result.
	 *
	 * @param rpcName The name of the RPC to perform.
	 * @param paramNames The parameter names
	 * @param paramValues The parameter values
	 * @returns A promise that resolves to the result of the RPC, or rejects
	 *  with a PositronCommError.
	 */
	protected async performRpc<T>(
		rpcName: string,
		paramNames: Array<string>,
		paramValues: Array<any>
	): Promise<T> {
		// Create the RPC arguments from the parameter names and values. This
		// allows us to pass the parameters as positional parameters, but
		// still have them be named parameters in the RPC.
		const rpcArgs: any = {};
		for (let i = 0; i < paramNames.length; i++) {
			rpcArgs[paramNames[i]] = paramValues[i];
		}

		// Form the request object
		const request: any = {
			jsonrpc: '2.0',
			method: rpcName,
		};

		// Amend params if we have any (methods which take no parameters
		// should not have a params field)
		if (paramNames.length > 0) {
			request.params = rpcArgs;
		}

		// Perform the RPC
		let response = {} as any;
		try {
			response = await this.clientInstance.performRpc<any>(request);
		} catch (err: any) {
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
			const error: PositronCommError = response.error;

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
				message:
					`Invalid response from ${this.clientInstance.getClientId()}: ` +
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

	dispose() {
		this.clientInstance.dispose();
		this._disposables.forEach((d) => d.dispose());
	}

	/**
	 * Create a new event emitter.
	 * @param name The name of the event, as a JSON-RPC method name.
	 * @param properties The names of the properties in the event payload; used
	 *  to convert positional parameters to named parameters.
	 * @returns An event emitter that can be used to listen for events sent from the backend.
	 */
	protected createEventEmitter<T>(
		name: string,
		properties: string[]
	): Event<T> {
		const event = this.clientInstance.onDidSendEvent((output) => {
			const event = output.data as any;
			if (event.method === name) {
				const args = event.params;
				const namedArgs: any = {};
				for (let i = 0; i < properties.length; i++) {
					namedArgs[properties[i]] = args[i];
				}
				this._emitters.get(name)?.fire(namedArgs);
			}
		});
		this._disposables.push(event);

		const emitter = new PositronCommEmitter<T>(name, properties);
		this._disposables.push(emitter);

		this._emitters.set(name, emitter);
		return emitter.event;
	}

	/**
	 * A map of event names to emitters. This is used to create event emitters
	 * from the backend to the frontend.
	 */
	private _emitters = new Map<string, PositronCommEmitter<any>>();
}
