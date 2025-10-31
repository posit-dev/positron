/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IPositronNotebookEditor } from './IPositronNotebookEditor.js';

export const INotebookEditorProxyService = createDecorator<INotebookEditorProxyService>('INotebookEditorProxyService');

/**
 * Proxy that combines Positron and VSCode notebook editors behind a subset of the INotebookEditorService interface.
 */
export interface INotebookEditorProxyService {
	_serviceBrand: undefined;

	onDidAddNotebookEditor: Event<IPositronNotebookEditor>;
	onDidRemoveNotebookEditor: Event<IPositronNotebookEditor>;
	listNotebookEditors(): readonly IPositronNotebookEditor[];
}
