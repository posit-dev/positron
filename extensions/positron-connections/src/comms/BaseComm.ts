/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// This is a copy of PositronBaseCommm.ts adapted to work on the extensions land.
// It mainly ports the logic that is used to check argument types and prepare and RPC request
// to the backend as well as the logic to handle errors returned by the backend.

import * as positron from 'positron';

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
	constructor(private readonly clientInstance: positron.RuntimeClientInstance) { }

	/**
	 * Perform an RPC and wait for the result.
	 *
	 * @param rpcName The name of the RPC to perform.
	 * @param paramNames The parameter names
	 * @param paramValues The parameter values
	 * @returns A promise that resolves to the result of the RPC, or rejects
	 *  with a PositronCommError.
	 */
	protected async performRpc<T>(rpcName: string,
		paramNames: Array<string>,
		paramValues: Array<any>): Promise<T> {

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
			response = await this.clientInstance.performRpc(request);
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

	dispose() {
		this.clientInstance.dispose();
	}
}
