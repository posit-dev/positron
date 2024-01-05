/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as extHostProtocol from './extHost.positron.protocol';
import { ExtHostEditors } from '../extHostTextEditors';
import { EditorContextResult, FrontendRequest } from 'vs/workbench/services/languageRuntime/common/positronFrontendComm';

export class ExtHostMethods implements extHostProtocol.ExtHostMethodsShape {
	constructor(
		_mainContext: extHostProtocol.IMainPositronContext,
		private readonly editors: ExtHostEditors,
	) {
	}

	// Parses arguments and calls relevant method
	async call(method: FrontendRequest, params: any): Promise<any> {
		// FIXME: Throw typed JSON-RPC errors
		if (!Object.values(FrontendRequest).includes(method)) {
			throw new Error(`Undefined method ${method}`);
		}

		// TODO: Use a library or write our own tool to type-check
		// arguments according to the OpenRPC schema

		switch (method) {
			case FrontendRequest.LastActiveEditorContext: {
				if (params && Object.keys(params).length > 0) {
					throw new Error(`Unexpected arguments for '${method}'`);
				}
				return this.lastActiveTextEditorContext();
			}
			case FrontendRequest.DebugSleep: {
				if (!params || !Object.keys(params).includes('ms')) {
					throw new Error(`Unexpected arguments for '${method}'`);
				}
				return this.debugSleep(params.ms as number);
			}
		}
	}

	async lastActiveTextEditorContext(): Promise<EditorContextResult | null> {
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

async function delay(ms: number) {
	return new Promise(resolve => setTimeout(resolve, ms));
}
