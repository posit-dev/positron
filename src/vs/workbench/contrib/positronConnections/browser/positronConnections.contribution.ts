/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import * as nls from '../../../../nls.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { Extensions, IViewContainersRegistry, IViewsRegistry, ViewContainerLocation } from '../../../common/views.js';
import { POSITRON_CONNECTIONS_VIEW_ID } from '../../../services/positronConnections/common/interfaces/positronConnectionsService.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { PositronConnectionsView } from './positronConnectionsView.js';
import { POSITRON_CONNECTIONS_VIEW_ENABLED } from '../../../services/positronConnections/browser/positronConnectionsFeatureFlag.js';

const positronConnectionsViewIcon = registerIcon(
	'positron-connections-view-icon',
	Codicon.database,
	nls.localize('positronConnectionsViewIcon', 'View icon of the Positron Connections view.')
);

const VIEW_CONTAINER = Registry.as<IViewContainersRegistry>(Extensions.ViewContainersRegistry).registerViewContainer(
	{
		id: POSITRON_CONNECTIONS_VIEW_ID,
		title: {
			value: nls.localize('positron.connections', "Connections"),
			original: 'Connections'
		},
		icon: positronConnectionsViewIcon,
		order: 2,
		ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [POSITRON_CONNECTIONS_VIEW_ID, { mergeViewWithContainerWhenSingleView: true }]),
		storageId: POSITRON_CONNECTIONS_VIEW_ID,
		hideIfEmpty: true,
	},
	ViewContainerLocation.AuxiliaryBar,
	{
		doNotRegisterOpenCommand: false,
		isDefault: false
	}
);

Registry.as<IViewsRegistry>(Extensions.ViewsRegistry).registerViews([{
	id: POSITRON_CONNECTIONS_VIEW_ID,
	name: {
		value: nls.localize('positron.help', "Connections core"),
		original: 'Connections core'
	},
	containerIcon: positronConnectionsViewIcon,
	canMoveView: true,
	canToggleVisibility: false,
	ctorDescriptor: new SyncDescriptor(PositronConnectionsView),
	positronAlwaysOpenView: true,
	when: POSITRON_CONNECTIONS_VIEW_ENABLED,
	// openCommandActionDescriptor: {
	// 	id: 'workbench.action.positron.openHelp',
	// 	keybindings: {
	// 		primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyH,
	// 	},
	// 	order: 1,
	// }
}], VIEW_CONTAINER);
