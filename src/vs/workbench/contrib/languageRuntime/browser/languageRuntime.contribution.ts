/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import { INotebookBridgeService } from 'vs/workbench/contrib/languageRuntime/common/languageRuntime';
import { NotebookBridgeService } from 'vs/workbench/contrib/languageRuntime/common/notebookBridgeService';
import { registerLanguageRuntimeActions } from 'vs/workbench/contrib/languageRuntime/common/languageRuntimeActions';
import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';

// Register commands
registerLanguageRuntimeActions();

registerSingleton(INotebookBridgeService, NotebookBridgeService, InstantiationType.Delayed);
