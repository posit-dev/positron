/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { PositronDataViewPane } from './positronDataConnectionsView.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { ViewContainer, IViewContainersRegistry, ViewContainerLocation, Extensions as ViewContainerExtensions, IViewsRegistry } from '../../../common/views.js';

// The Positron data connections view ID.
const POSITRON_DATA_CONNECTIONS_VIEW_ID = 'workbench.panel.positronDataConnections';

// The Positron data connections view icon.
const positronDataConnectionsViewIcon = registerIcon(
	'positron-data-connections-view-icon',
	Codicon.positronDataConnections,
	localize('positronDataConnectionsViewIcon', 'View icon of the Positron Data Connections view.')
);

// Register the Positron data connections view container.
const VIEW_CONTAINER: ViewContainer = Registry.as<IViewContainersRegistry>(
	ViewContainerExtensions.ViewContainersRegistry
).registerViewContainer(
	{
		id: POSITRON_DATA_CONNECTIONS_VIEW_ID,
		title: {
			value: localize('positron.dataConnections', "Data Connections"),
			original: 'Data Connections'
		},
		icon: positronDataConnectionsViewIcon,
		order: 2,
		ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [POSITRON_DATA_CONNECTIONS_VIEW_ID, { mergeViewWithContainerWhenSingleView: true }]),
		storageId: POSITRON_DATA_CONNECTIONS_VIEW_ID,
		hideIfEmpty: false,
	},
	ViewContainerLocation.Sidebar,
	{
		doNotRegisterOpenCommand: false,
		isDefault: false
	}
);

// Register the Positron data connections view.
Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry).registerViews([{
	id: POSITRON_DATA_CONNECTIONS_VIEW_ID,
	name: {
		value: localize('positron.dataConnections', "Data Connections"),
		original: 'Data Connections'
	},
	containerIcon: positronDataConnectionsViewIcon,
	canMoveView: true,
	canToggleVisibility: false,
	ctorDescriptor: new SyncDescriptor(PositronDataViewPane),
	positronAlwaysOpenView: true,
	openCommandActionDescriptor: {
		id: 'workbench.action.positron.toggleDataConnections',
		mnemonicTitle: localize({ key: 'miToggleDataConnections', comment: ['&& denotes a mnemonic'] }, "&&Data Connections"),
		keybindings: {},
		order: 3,
	}
}], VIEW_CONTAINER);
