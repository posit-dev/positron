/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { usePositronReactServicesContext } from '../../../../base/browser/positronReactRendererContext.js';
import { NotebookContextKeys } from '../common/notebookContextKeys.js';
import { useContextKeyValue } from './useContextKeyValue.js';

/**
 * Returns whether `positron.notebook.experimental` is currently enabled.
 * Re-renders the calling component when the flag flips.
 */
export function usePositronNotebookExperimental(): boolean {
	const contextKeyService = usePositronReactServicesContext().contextKeyService;
	return useContextKeyValue(contextKeyService, NotebookContextKeys.experimental) ?? false;
}
