/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { INotebookEditorService } from '../../notebook/browser/services/notebookEditorService.js';

export const INotebookEditorProxyService = createDecorator<INotebookEditorProxyService>('INotebookEditorProxyService');

/**
 * Proxy that combines Positron and VSCode notebook editors behind the INotebookEditorService interface.
 */
export type INotebookEditorProxyService = Pick<
	INotebookEditorService,
	'_serviceBrand' |
	'listNotebookEditors' |
	'onDidAddNotebookEditor' |
	'onDidRemoveNotebookEditor'
>;
