/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { URI, UriComponents } from '../../../../base/common/uri.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { MenuId } from '../../../../platform/actions/common/actions.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { PositronActionBarWidgetRegistry } from '../../../../platform/positronActionBar/browser/positronActionBarWidgetRegistry.js';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions } from '../../../common/contributions.js';
import { ResourceContextKey } from '../../../common/contextkeys.js';
import { LifecyclePhase } from '../../../services/lifecycle/common/lifecycle.js';
import { POSITRON_NOTEBOOK_EDITOR_ID } from '../../positronNotebook/common/positronNotebookCommon.js';
import { QUARTO_LANGUAGE_IDS } from '../../positronQuarto/common/positronQuartoConfig.js';
import { IMissingPackagesService } from '../common/missingPackagesService.js';
import { MissingPackagesService } from './missingPackagesServiceImpl.js';
import { MissingPackageFollowupContribution } from './missingPackageProvider.js';
import { MissingPackagesBadgeMount } from './missingPackagesBadgeMount.js';
import { MissingPackagesPrecomputeContribution } from './missingPackagesPrecompute.js';
import { IMissingPackagesPreflightService, MissingPackagesPreflightService } from './missingPackagesPreflightService.js';

// Register the missing-packages services.
registerSingleton(IMissingPackagesService, MissingPackagesService, InstantiationType.Delayed);
registerSingleton(IMissingPackagesPreflightService, MissingPackagesPreflightService, InstantiationType.Delayed);

// Command used by extension-controlled run gestures (e.g. R's source-file) to
// run the preflight check in the frontend. Returns whether to proceed to run.
CommandsRegistry.registerCommand('positron.missingPackages.preflight', (accessor: ServicesAccessor, resource: UriComponents): Promise<boolean> => {
	return accessor.get(IMissingPackagesPreflightService).confirmBeforeRun(URI.revive(resource));
});

const workbenchRegistry = Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench);

// Register the console-error followup provider that offers to install missing
// packages reported by runtime errors (scenario 3).
workbenchRegistry.registerWorkbenchContribution(MissingPackageFollowupContribution, LifecyclePhase.Restored);

// Keep the cache warm for the active editor so the preflight check never blocks.
workbenchRegistry.registerWorkbenchContribution(MissingPackagesPrecomputeContribution, LifecyclePhase.Restored);

// Editor action bar badge (scenario 2) for Python and R scripts and Quarto
// documents. The editor action bar is disabled for notebooks, so notebooks get
// a separate mount below. Quarto documents are multi-language; the service
// splits them into per-language code chunks and routes each to its session.
PositronActionBarWidgetRegistry.registerWidget({
	id: 'positronMissingPackages.editorBadge',
	menuId: MenuId.EditorActionsRight,
	order: 95,
	when: ContextKeyExpr.or(
		ContextKeyExpr.equals(ResourceContextKey.LangId.key, 'python'),
		ContextKeyExpr.equals(ResourceContextKey.LangId.key, 'r'),
		...QUARTO_LANGUAGE_IDS.map(langId => ContextKeyExpr.equals(ResourceContextKey.LangId.key, langId)),
	),
	selfContained: true,
	componentFactory: (accessor) => () => React.createElement(MissingPackagesBadgeMount, { accessor }),
});

// Positron notebook toolbar badge (scenario 2). Same component, scoped to the
// Positron notebook editor. Placed before the menu's action buttons so the
// badge sits to the left of the restart button, rather than between it and the
// kernel status indicator (which is a trailing, default-placement widget).
PositronActionBarWidgetRegistry.registerWidget({
	id: 'positronMissingPackages.notebookBadge',
	menuId: MenuId.EditorActionsRight,
	order: 95,
	placement: 'before',
	when: ContextKeyExpr.equals('activeEditor', POSITRON_NOTEBOOK_EDITOR_ID),
	selfContained: true,
	componentFactory: (accessor) => () => React.createElement(MissingPackagesBadgeMount, { accessor }),
});
