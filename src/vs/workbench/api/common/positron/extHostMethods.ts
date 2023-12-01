/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as extHostProtocol from './extHost.positron.protocol';
import { ITextEditorContext } from "vs/workbench/services/frontendMethods/common/editorContext";
import { ExtHostEditors } from '../extHostTextEditors';

export class ExtHostMethods implements extHostProtocol.ExtHostMethodsShape {
	constructor(
		_mainContext: extHostProtocol.IMainPositronContext,
		private readonly editors: ExtHostEditors,
	) {
	}

	async lastActiveTextEditorContext(): Promise<ITextEditorContext | undefined> {
		let editor = this.editors.getActiveTextEditor();
		if (!editor) {
			return undefined;
		}

		return { path: editor.document.fileName };
	}
}
