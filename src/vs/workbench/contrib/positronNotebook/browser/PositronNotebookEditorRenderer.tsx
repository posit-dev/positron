/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../base/browser/dom.js';
import { PositronReactRenderer } from '../../../../base/browser/positronReactRenderer.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IPositronNotebookInstance } from './IPositronNotebookInstance.js';
import { PositronNotebookComponent } from './PositronNotebookComponent.js';

export class PositronNotebookEditorRenderer extends Disposable {
	/**
	 * Top-level container for the entire notebook editor.
	 * Contains both the notebook content and contributions.
	 */
	public readonly editorContainer: HTMLElement;

	/**
	 * Stable shell element that hosts the active per-entry notebook container.
	 * Lives for the life of the pane; per-entry containers (which hold the
	 * React tree) are reparented in and out of it on setInput/clearInput.
	 */
	private readonly _notebookShell: HTMLElement;

	/**
	 * Overlay container for contributions (like find widget) to render into,
	 * allowing them to maintain their own separate React roots.
	 * Sibling to _notebookShell, child of _editorContainer.
	 * Inherits scoped context keys from _editorContainer.
	 * Hidden when switching notebooks to prevent stale widgets from showing.
	 */
	public readonly overlayContainer: HTMLElement;

	public readonly notebookContainer: HTMLElement;

	private readonly _renderer: PositronReactRenderer;

	constructor(
		@ILogService private readonly _logService: ILogService,
	) {
		super();

		// Create the top-level editor container
		this.editorContainer = DOM.$('.positron-notebook-editor');

		// TODO: Maybe the parent should do this...?
		// editorContainer.appendChild(this._container);

		// Stable shell; per-entry containers are created lazily on cache miss
		// (see _renderFreshForInput) and reparented in/out of this shell.
		this._notebookShell = DOM.$('.positron-notebook-shell');
		this.editorContainer.appendChild(this._notebookShell);

		// Create the overlay container for widgets (find, etc)
		this.overlayContainer = DOM.$('.positron-notebook-overlay-container');
		this.editorContainer.appendChild(this.overlayContainer);

		this.notebookContainer = DOM.$('.positron-notebook-container');
		this.notebookContainer.tabIndex = -1;
		this._notebookShell.appendChild(this.notebookContainer);

		this._renderer = this._register(new PositronReactRenderer(this.notebookContainer));
	}

	render(
		notebookInstance: IPositronNotebookInstance,
	): void {
		// TODO: Set the editor container for focus tracking.
		// this.notebookInstance.setEditorContainer(this._editorContainer);

		this._renderer.render(
			<PositronNotebookComponent
				notebookInstance={notebookInstance}
				onReload={() => {
					this.render(notebookInstance);
				}}
			/>
		);
	}

	override dispose(): void {
		this._logService.debug('PositronNotebookEditorView', 'dispose');
		super.dispose();
		this.editorContainer.remove();
	}
}
