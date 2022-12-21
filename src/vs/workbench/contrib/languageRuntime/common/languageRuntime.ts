/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

export const REPL_VIEW_ID = 'repl';
import * as nls from 'vs/nls';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';

export interface INotebookBridgeService {
	readonly _serviceBrand: undefined;
	// Stub for dependency injection; this service has no public methods.
}

export const INotebookBridgeService = createDecorator<INotebookBridgeService>('notebookBridgeService');

export const LANGUAGE_RUNTIME_ACTION_CATEGORY = nls.localize('languageRuntimeCategory', "Language Runtime");
