/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IEditorOptions } from '../../../../../editor/common/config/editorOptions.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { CellEditorOptions } from '../../../notebook/browser/view/cellParts/cellEditorOptions.js';
import { BaseCellEditorOptions } from '../BaseCellEditorOptions.js';
import { IPositronNotebookInstance } from '../IPositronNotebookInstance.js';

/**
 * Provides options for a notebook cell's `CodeEditorWidget`.
 * Wraps {@link CellEditorOptions} with Positron-specific overrides.
 */
export class PositronCellEditorOptions extends Disposable {
	/** The wrapped cell editor options */
	private readonly _options: CellEditorOptions;

	/** Event that fires when the editor options change */
	public readonly onDidChange: Event<void>;

	constructor(
		public readonly notebook: IPositronNotebookInstance,
		public readonly language: string,
		@IConfigurationService configurationService: IConfigurationService,
	) {
		super();

		this._options = this._register(new CellEditorOptions(
			notebook.getBaseCellEditorOptions(language),
			notebook.notebookOptions,
			configurationService,
		));

		this.onDidChange = this._options.onDidChange;
	}

	/** Get the current editor options. */
	getValue(): IEditorOptions {
		const value = this._options.getDefaultValue();
		return withPositronOverrides(value);
	}
}

export function getInitialCellEditorOptions(): IEditorOptions {
	return withPositronOverrides(BaseCellEditorOptions.fixedEditorOptions);
}

function withPositronOverrides(options: IEditorOptions): IEditorOptions {
	return {
		...options,
		// Override padding for Positron notebooks to add breathing room between action bar and editor content
		padding: { top: 16, bottom: 16 },
		// Smaller scrollbars since we embed many editor widgets
		scrollbar: {
			...options.scrollbar,
			verticalScrollbarSize: 8,
			horizontalScrollbarSize: 8,
		},
		tabIndex: -1, // Remove editor from tab order - use Enter to focus
	};
}
