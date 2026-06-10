/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { usePositronContextKey } from '../../../../base/browser/positronReactHooks.js';
import { NotebookContextKeys } from '../common/notebookContextKeys.js';

/**
 * Returns whether `positron.notebook.experimental` is currently enabled.
 * Re-renders the calling component when the flag flips.
 */
export function usePositronNotebookExperimental(): boolean {
	return usePositronContextKey<boolean>(NotebookContextKeys.experimental.key) ?? false;
}
