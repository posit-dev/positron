/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as extHostProtocol from './extHost.positron.protocol';
import { ExtHostEditors } from '../extHostTextEditors';
import { EditorContextResult, FrontendRequest } from 'vs/workbench/services/languageRuntime/common/positronFrontendComm';
import { JsonRpcErrorCode } from 'vs/workbench/services/languageRuntime/common/positronBaseComm';


type JsonRpcResponse = JsonRpcResult | JsonRpcError;

interface JsonRpcResult {
	result: any;
}
interface JsonRpcError {
	error: JsonRpcErrorData;
}

interface JsonRpcErrorData {
	/** An error code */
	code: JsonRpcErrorCode;

	/** A human-readable error message */
	message: string;

	/** Additional error information (optional) */
	data?: any;
}

export class ExtHostMethods implements extHostProtocol.ExtHostMethodsShape {
	constructor(
		_mainContext: extHostProtocol.IMainPositronContext,
		private readonly editors: ExtHostEditors,
	) {
	}

	// Parses arguments and calls relevant method. Does not throw, returns
	// JSON-RPC error responses instead.
	async call(method: FrontendRequest, params: Record<string, any>): Promise<JsonRpcResponse> {
		try {
			if (!Object.values(FrontendRequest).includes(method)) {
				return <JsonRpcError> {
					error: {
						code: JsonRpcErrorCode.MethodNotFound,
						message: `Can't find method ${method}`,
					}
				};
			}

			// TODO: Use a library or write our own tool to type-check
			// arguments according to the OpenRPC schema

			let result;
			switch (method) {
				case FrontendRequest.LastActiveEditorContext: {
					if (params && Object.keys(params).length > 0) {
						return newInvalidParamsError(method);
					}
					result = await this.lastActiveEditorContext();
					break;
				}
				case FrontendRequest.DebugSleep: {
					if (!params || !Object.keys(params).includes('ms')) {
						return newInvalidParamsError(method);
					}
					result = await this.debugSleep(params.ms as number);
					break;
				}
			}

			return <JsonRpcResult>({ result });
		} catch (e) {
			return <JsonRpcError> {
				error: {
					code: JsonRpcErrorCode.InternalError,
					message: `Internal error: ${e}`,
				}
			};
		}
	}

	async lastActiveEditorContext(): Promise<EditorContextResult | null> {
		const editor = this.editors.getActiveTextEditor();
		if (!editor) {
			return null;
		}

		return { path: editor.document.fileName };
	}

	async debugSleep(ms: number): Promise<null> {
		await delay(ms);
		return null;
	}
}


/* Utils */

function newInvalidParamsError(method: FrontendRequest) {
	return <JsonRpcError> {
		error: {
			code: JsonRpcErrorCode.InvalidParams,
			message: `Unexpected arguments for '${method}'`,
		}
	};
}

async function delay(ms: number) {
	return new Promise(resolve => setTimeout(resolve, ms));
}
