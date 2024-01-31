/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as extHostProtocol from './extHost.positron.protocol';
import { ExtHostEditors } from '../extHostTextEditors';
import { UiFrontendRequest, EditorContext } from 'vs/workbench/services/languageRuntime/common/positronUiComm';
import { JsonRpcErrorCode } from 'vs/workbench/services/languageRuntime/common/positronBaseComm';
import { EndOfLine } from '../extHostTypeConverters';

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
	async call(method: UiFrontendRequest, params: Record<string, any>): Promise<JsonRpcResponse> {
		try {
			if (!Object.values(UiFrontendRequest).includes(method)) {
				return <JsonRpcError>{
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
				case UiFrontendRequest.LastActiveEditorContext: {
					if (params && Object.keys(params).length > 0) {
						return newInvalidParamsError(method);
					}
					result = await this.lastActiveEditorContext();
					break;
				}
				case UiFrontendRequest.DebugSleep: {
					if (!params || !Object.keys(params).includes('ms')) {
						return newInvalidParamsError(method);
					}
					result = await this.debugSleep(params.ms as number);
					break;
				}
			}

			return <JsonRpcResult>({ result });
		} catch (e) {
			return <JsonRpcError>{
				error: {
					code: JsonRpcErrorCode.InternalError,
					message: `Internal error: ${e}`,
				}
			};
		}
	}

	async lastActiveEditorContext(): Promise<EditorContext | null> {
		const editor = this.editors.getActiveTextEditor();
		if (!editor) {
			return null;
		}

		// The selections in this text editor. The primary selection is always at index 0.
		//
		// The gymnastics here are so that we return character positions with respect to
		// Unicode code points. Otherwise, the native Position type provides offsets with respect to
		// UTF-16 encoded text. That would be confusing for downstream consumers, who probably
		// ultimately receive this text as UTF-8 and want to operate on this text in terms of
		// as user-perceivable "characters". This only matters when the selection's neighborhood
		// includes Unicode characters in the astral plane.
		//
		// Another resource that supports that what I'm doing here is desirable in Jupyter-land:
		// https://jupyter-client.readthedocs.io/en/latest/messaging.html#notes
		const selections = editor.selections.map(selection => {
			const lineTextBeforeActive = editor.document
				.lineAt(selection.active.line)
				.text.substring(0, selection.active.character);
			const unicodePointsBeforeActive = Array.from(lineTextBeforeActive).length;

			const lineTextBeforeStart = editor.document
				.lineAt(selection.start.line)
				.text.substring(0, selection.start.character);
			const unicodePointsBeforeStart = Array.from(lineTextBeforeStart).length;

			const text = editor.document.getText(selection);
			const unicodePointsInSelection = Array.from(text).length;

			return {
				active: { line: selection.active.line, character: unicodePointsBeforeActive },
				start: { line: selection.start.line, character: unicodePointsBeforeStart },
				end: { line: selection.end.line, character: unicodePointsBeforeStart + unicodePointsInSelection },
				text: text
			};
		});

		// it's surprisingly fiddly to finesse this vscode.EndOfLife enum, which we don't have
		// direct access to here
		const eolSequenceEnum = EndOfLine.from(editor.document.eol);
		const eolSequence = eolSequenceEnum === 0 ? '\n' : '\r\n';
		const documentText = editor.document.getText();
		const lines = documentText.split(eolSequence);

		return {
			document: {
				path: editor.document.fileName,
				eol: eolSequence,
				is_closed: editor.document.isClosed,
				is_dirty: editor.document.isDirty,
				is_untitled: editor.document.isUntitled,
				language_id: editor.document.languageId,
				line_count: editor.document.lineCount,
				version: editor.document.version,
			},
			contents: lines,
			// The primary selection in this text editor. Shorthand for `TextEditor.selections[0]`.
			selection: selections[0],
			selections: selections
		};
	}

	async debugSleep(ms: number): Promise<null> {
		await delay(ms);
		return null;
	}
}


/* Utils */

function newInvalidParamsError(method: UiFrontendRequest) {
	return <JsonRpcError>{
		error: {
			code: JsonRpcErrorCode.InvalidParams,
			message: `Unexpected arguments for '${method}'`,
		}
	};
}

async function delay(ms: number) {
	return new Promise(resolve => setTimeout(resolve, ms));
}
