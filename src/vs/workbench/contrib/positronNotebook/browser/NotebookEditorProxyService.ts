/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { INotebookEditorService } from '../../notebook/browser/services/notebookEditorService.js';
import { INotebookEditor, getNotebookEditorFromEditorPane as getVscodeNotebookEditorFromEditorPane } from '../../notebook/browser/notebookBrowser.js';
import { IPositronNotebookService } from './positronNotebookService.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { INotebookEditorProxyService } from './INotebookEditorProxyService.js';
import { getNotebookInstanceFromEditorPane } from './notebookUtils.js';
import { IEditorPane } from '../../../common/editor.js';
import { IPositronNotebookEditor } from './IPositronNotebookEditor.js';

/**
 * Proxy that combines Positron and VSCode notebook editors behind the INotebookEditorService interface.
 */
export class NotebookEditorProxyService extends Disposable implements INotebookEditorProxyService {
	readonly _serviceBrand: undefined;

	private readonly _onDidAddNotebookEditorEmitter = this._register(new Emitter<IPositronNotebookEditor>());
	private readonly _onDidRemoveNotebookEditorEmitter = this._register(new Emitter<IPositronNotebookEditor>());

	public readonly onDidAddNotebookEditor = this._onDidAddNotebookEditorEmitter.event;
	public readonly onDidRemoveNotebookEditor = this._onDidRemoveNotebookEditorEmitter.event;

	constructor(
		@INotebookEditorService private readonly _notebookEditorService: INotebookEditorService,
		@IPositronNotebookService private readonly _positronNotebookService: IPositronNotebookService
	) {
		super();

		// Forward events from the notebook editor service
		this._register(this._notebookEditorService.onDidAddNotebookEditor((editor) => {
			this._onDidAddNotebookEditorEmitter.fire(editor);
		}));
		this._register(this._notebookEditorService.onDidRemoveNotebookEditor((editor) => {
			this._onDidRemoveNotebookEditorEmitter.fire(editor);
		}));

		// Forward events from the Positron notebook service
		this._register(this._positronNotebookService.onDidAddNotebookInstance(instance => {
			this._onDidAddNotebookEditorEmitter.fire(instance);
		}));
		this._register(this._positronNotebookService.onDidRemoveNotebookInstance(instance => {
			this._onDidRemoveNotebookEditorEmitter.fire(instance);
		}));
	}

	listNotebookEditors(): readonly IPositronNotebookEditor[] {
		return [
			...this._notebookEditorService.listNotebookEditors(),
			...this._positronNotebookService.listInstances(),
		];
	}
}

registerSingleton(INotebookEditorProxyService, NotebookEditorProxyService, InstantiationType.Delayed);

/**
 * Gets a notebook editor from an editor pane, returning it as INotebookEditor.
 * This allows upstream code to work with both VS Code and Positron notebooks transparently.
 * Positron notebooks implement the subset of INotebookEditor needed by chat editing integration.
 * @param editorPane - The editor pane to extract a notebook editor from.
 * @returns The notebook editor as INotebookEditor, or undefined if not found.
 */
export function getNotebookEditorFromEditorPane(editorPane?: IEditorPane): INotebookEditor | undefined {
	// Check for Positron notebook instance first
	const notebookInstance = getNotebookInstanceFromEditorPane(editorPane);
	if (notebookInstance) {
		// Cast to INotebookEditor - Positron notebooks implement the necessary subset of the interface
		return notebookInstance as unknown as INotebookEditor;
	}
	// Fall back to VS Code notebook editor
	return getVscodeNotebookEditorFromEditorPane(editorPane);
}
