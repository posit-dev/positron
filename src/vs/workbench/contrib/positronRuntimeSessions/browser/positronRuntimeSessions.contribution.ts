/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { Codicon } from 'vs/base/common/codicons';
import { Registry } from 'vs/platform/registry/common/platform';
import { registerIcon } from 'vs/platform/theme/common/iconRegistry';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { ViewPaneContainer } from 'vs/workbench/browser/parts/views/viewPaneContainer';
import { ViewContainer, IViewContainersRegistry, ViewContainerLocation, Extensions as ViewContainerExtensions, IViewsRegistry } from 'vs/workbench/common/views';
import { PositronRuntimeSessionsViewPane } from 'vs/workbench/contrib/positronRuntimeSessions/browser/positronRuntimeSessionsView';

// The Positron sessions view identifier.
export const POSITRON_RUNTIME_SESSIONS_VIEW_ID = 'workbench.panel.positronSessions';

// The Positron sessions view icon.
const positronRuntimeSessionsViewIcon = registerIcon(
	'positron-runtime-sessions-view-icon',
	Codicon.versions,
	nls.localize('positronRuntimeSessionsViewIcon', 'View icon of the Positron sessions view.')
);

// Register the Positron sessions view container.
export const VIEW_CONTAINER: ViewContainer = Registry.as<IViewContainersRegistry>(
	ViewContainerExtensions.ViewContainersRegistry
).registerViewContainer(
	{
		id: POSITRON_RUNTIME_SESSIONS_VIEW_ID,
		title: {
			value: nls.localize('positron.view.runtime.sessions', "Runtimes"),
			original: 'Session'
		},
		icon: positronRuntimeSessionsViewIcon,
		order: 1,
		ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [POSITRON_RUNTIME_SESSIONS_VIEW_ID, { mergeViewWithContainerWhenSingleView: true }]),
		storageId: POSITRON_RUNTIME_SESSIONS_VIEW_ID,
		hideIfEmpty: false,
	},
	ViewContainerLocation.AuxiliaryBar,
	{
		doNotRegisterOpenCommand: false,
		isDefault: false
	}
);

// Register the Positron sessions view.
Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry).registerViews(
	[
		{
			id: POSITRON_RUNTIME_SESSIONS_VIEW_ID,
			name: {
				// "Sessions" might be a better name than "Runtimes" for the view,
				// but "Session" is already a view name and that could get A
				// Little Confusing.
				value: nls.localize('positron.view.runtime.sessions', "Runtimes"),
				original: 'Runtimes'
			},
			ctorDescriptor: new SyncDescriptor(PositronRuntimeSessionsViewPane),
			canToggleVisibility: true,
			hideByDefault: true,
			canMoveView: true,
			containerIcon: positronRuntimeSessionsViewIcon
		}
	],
	VIEW_CONTAINER
);

