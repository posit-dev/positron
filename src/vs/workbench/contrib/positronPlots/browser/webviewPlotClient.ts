/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { INotebookOutputWebview } from 'vs/workbench/contrib/positronOutputWebview/browser/notebookOutputWebviewService';
import { IPositronPlotMetadata } from 'vs/workbench/services/languageRuntime/common/languageRuntimePlotClient';
import { ILanguageRuntimeMessageOutput } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IPositronPlotClient } from 'vs/workbench/services/positronPlots/common/positronPlots';

/**
 * A Positron plot instance that is backed by a webview.
 */
export class WebviewPlotClient extends Disposable implements IPositronPlotClient {

	public readonly metadata: IPositronPlotMetadata;

	constructor(public readonly webview: INotebookOutputWebview,
		message: ILanguageRuntimeMessageOutput,
		code?: string) {
		super();

		// Create the metadata for the plot.
		this.metadata = {
			id: message.id,
			parent_id: message.parent_id,
			created: Date.parse(message.when),
			runtime_id: webview.runtimeId,
			code: code ? code : '',
		};
	}

	get id(): string {
		return this.metadata.id;
	}

	override dispose(): void {
		super.dispose();
	}
}
