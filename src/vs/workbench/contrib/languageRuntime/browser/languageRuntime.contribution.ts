/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { LanguageRuntimeService } from 'vs/workbench/contrib/languageRuntime/browser/languageRuntimeService';
import { ILanguageRuntimeService } from 'vs/workbench/contrib/languageRuntime/common/languageRuntimeService';

// Register REPL service singleton with platform
registerSingleton(ILanguageRuntimeService, LanguageRuntimeService, true);
