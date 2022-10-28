/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import { registerLanguageRuntimeActions } from 'vs/workbench/contrib/languageRuntime/common/languageRuntimeActions';
import { Registry } from 'vs/platform/registry/common/platform';
import { LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { NotebookBridgeContribution } from 'vs/workbench/contrib/languageRuntime/common/notebookBridgeContribution';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions } from 'vs/workbench/common/contributions';

// Register commands
registerLanguageRuntimeActions();

// Register notebook bridge contribution
const workbenchRegistry = Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench);
workbenchRegistry.registerWorkbenchContribution(NotebookBridgeContribution, LifecyclePhase.Restored);

