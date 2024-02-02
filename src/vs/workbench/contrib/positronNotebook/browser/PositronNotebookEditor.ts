/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Dimension, IDomPosition } from 'vs/base/browser/dom';
import { CancellationToken } from 'vs/base/common/cancellation';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { EditorPane } from 'vs/workbench/browser/parts/editor/editorPane';
import { IEditorOpenContext } from 'vs/workbench/common/editor';
import { PositronNotebookEditorInput } from './PositronNotebookEditorInput';



export class PositronNotebookEditor extends EditorPane {

	fileNameDiv: HTMLElement | undefined;

	protected override createEditor(parent: HTMLElement): void {

		const myDiv = parent.ownerDocument.createElement('div');
		myDiv.innerText = `Hello Positron!`;

		myDiv.style.outline = '1px solid red';
		myDiv.style.margin = '40px';
		myDiv.style.padding = '20px';
		myDiv.style.backgroundColor = 'lightgrey';
		this.fileNameDiv = parent.ownerDocument.createElement('div');

		myDiv.appendChild(this.fileNameDiv);

		parent.appendChild(myDiv);
	}

	override layout(dimension: Dimension, position?: IDomPosition | undefined): void {
		// throw new Error('Method not implemented.');\
		console.log('layout', { dimension, position });
	}

	override async setInput(input: PositronNotebookEditorInput, options: unknown | undefined, context: IEditorOpenContext, token: CancellationToken, noRetry?: boolean): Promise<void> {
		console.log('setInput', { input, options, context, token, noRetry });

		this.fileNameDiv!.innerText = input.resource.toString();
	}

	constructor(
		@IClipboardService readonly _clipboardService: IClipboardService,

		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService

	) {
		// Call the base class's constructor.
		super(PositronNotebookEditorInput.EditorID, telemetryService, themeService, storageService);

		// Logging.
	}

}
