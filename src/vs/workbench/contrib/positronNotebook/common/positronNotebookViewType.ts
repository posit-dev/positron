/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { extname } from '../../../../base/common/path.js';
import { URI } from '../../../../base/common/uri.js';

/** View types supported by Positron notebooks */
export enum PositronNotebookViewType {
	Jupyter = 'jupyter-notebook',
	Quarto = 'quarto-notebook'
}

/** View types supported by Positron notebooks */
export namespace PositronNotebookViewType {
	/**
	 * Get the view type for a given resource.
	 * @param resource The resource URI
	 * @returns The view type for this resource if supported, otherwise undefined
	 */
	export function fromResource(resource: URI): PositronNotebookViewType | undefined {
		const extension = extname(resource.path).toLowerCase();
		switch (extension) {
			case '.qmd':
				return PositronNotebookViewType.Quarto;
			case '.ipynb':
				return PositronNotebookViewType.Jupyter;
			default:
				return undefined;
		}
	}

	/**
	 * Get the expected file extension for a given view type.
	 * @param viewType The view type
	 * @returns The expected file extension for this view type
	 */
	export function getFileExtension(viewType: PositronNotebookViewType): string {
		switch (viewType) {
			case PositronNotebookViewType.Quarto:
				return 'qmd';
			case PositronNotebookViewType.Jupyter:
			default:
				return 'ipynb';
		}
	}

	/**
	 * Check if a given viewType is supported by Positron notebooks
	 * @param viewType The notebook viewType to check
	 * @returns true if Positron notebooks support this viewType
	 */
	export function isSupported(viewType: string): viewType is PositronNotebookViewType {
		return Object.values(PositronNotebookViewType).includes(viewType as PositronNotebookViewType);
	}
}
