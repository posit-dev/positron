/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { Registry } from 'vs/platform/registry/common/platform';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { ViewPaneContainer } from 'vs/workbench/browser/parts/views/viewPaneContainer';
import { ViewContainer, IViewContainersRegistry, ViewContainerLocation, Extensions as ViewContainerExtensions } from 'vs/workbench/common/views';
import { registerIcon } from 'vs/platform/theme/common/iconRegistry';
import { Codicon } from 'vs/base/common/codicons';

export const POSITRON_SESSION_VIEW_ID = 'workbench.panel.positronSession';

// The Positron variables view icon.
export const positronSessionViewIcon = registerIcon(
	'positron-session-view-icon',
	Codicon.positronVariablesView,
	nls.localize('positronSessionViewIcon', 'View icon of the Positron session view.')
);


/**
 * A view container for holding views related to the positron session.
 * E.g. variables and plots.
 */
export const POSITRON_SESSION_CONTAINER: ViewContainer = Registry.as<IViewContainersRegistry>(
	ViewContainerExtensions.ViewContainersRegistry
).registerViewContainer(
	{
		id: POSITRON_SESSION_VIEW_ID,
		title: {
			value: nls.localize('positron.session', "Session"),
			original: 'Session'
		},
		icon: positronSessionViewIcon,
		order: 1,
		ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [POSITRON_SESSION_VIEW_ID, { mergeViewWithContainerWhenSingleView: true }]),
		storageId: POSITRON_SESSION_VIEW_ID,
		hideIfEmpty: false,
	},
	ViewContainerLocation.AuxiliaryBar,
	{
		doNotRegisterOpenCommand: true,
		isDefault: true
	}
);
