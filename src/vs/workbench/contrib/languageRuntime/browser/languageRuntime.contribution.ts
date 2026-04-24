/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Registry } from '../../../../platform/registry/common/platform.js';
import { registerLanguageRuntimeActions } from './languageRuntimeActions.js';
import { PositronRuntimeLanguagesContextKeyContribution } from './languageRuntimeContextKeys.js';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions } from '../../../common/contributions.js';
import { LifecyclePhase } from '../../../services/lifecycle/common/lifecycle.js';
import './languageRuntimeActions.css';

// Register commands
registerLanguageRuntimeActions();

// Register the contribution that tracks language IDs with a registered
// Positron runtime, so menus/actions can scope to "this editor's language
// has a runtime" via `resourceLangId in positron.runtimeLanguageIds`.
Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench)
	.registerWorkbenchContribution(
		PositronRuntimeLanguagesContextKeyContribution,
		LifecyclePhase.Restored,
	);
