/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { LanguageRuntimeService } from 'vs/workbench/contrib/languageRuntime/browser/languageRuntimeService';
import { ILanguageRuntimeService } from 'vs/workbench/contrib/languageRuntime/common/languageRuntimeService';
import { registerLanguageRuntimeActions } from 'vs/workbench/contrib/languageRuntime/browser/languageRuntimeActions';

// Register language runtime singleton
registerSingleton(ILanguageRuntimeService, LanguageRuntimeService, InstantiationType.Delayed);

// Register commands
registerLanguageRuntimeActions();
