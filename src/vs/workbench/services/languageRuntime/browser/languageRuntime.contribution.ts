/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { LanguageRuntimeService } from 'vs/workbench/services/languageRuntime/browser/languageRuntimeService';
import { ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { registerLanguageRuntimeActions } from 'vs/workbench/services/languageRuntime/browser/languageRuntimeActions';

// Register language runtime singleton
registerSingleton(ILanguageRuntimeService, LanguageRuntimeService, InstantiationType.Delayed);

// Register commands
registerLanguageRuntimeActions();
