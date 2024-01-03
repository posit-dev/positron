/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as extHostProtocol from './extHost.positron.protocol';
import { ExtHostEditors } from '../extHostTextEditors';
import { EditorContextResult } from 'vs/workbench/services/languageRuntime/common/positronFrontendComm';

export class ExtHostMethods implements extHostProtocol.ExtHostMethodsShape {
	constructor(
		_mainContext: extHostProtocol.IMainPositronContext,
		private readonly editors: ExtHostEditors,
	) {
	}

	// Parses arguments and calls relevant method
	async call(method: string, params: any): Promise<any> {
		// FIXME: Throw typed JSON-RPC errors
		switch (method) {
			case 'last_active_editor_context': {
				if (params && params.len) {
					throw new Error(`Unexpected arguments for '${method}'`);
				}
				return this.lastActiveTextEditorContext();
			}
			default: {
				throw new Error(`Undefined method ${method}`)
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
}
