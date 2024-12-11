/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from '../../../../nls.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { ViewContainer, IViewContainersRegistry, ViewContainerLocation, Extensions as ViewContainerExtensions } from '../../../common/views.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { Codicon } from '../../../../base/common/codicons.js';

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
