/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from 'vs/base/common/codicons';
import { registerIcon } from 'vs/platform/theme/common/iconRegistry';
import * as nls from 'vs/nls';
import { Registry } from 'vs/platform/registry/common/platform';
import { Extensions, IViewContainersRegistry, IViewsRegistry, ViewContainerLocation } from 'vs/workbench/common/views';
import { POSITRON_CONNECTIONS_VIEW_ID } from 'vs/workbench/services/positronConnections/browser/interfaces/positronConnectionsService';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { ViewPaneContainer } from 'vs/workbench/browser/parts/views/viewPaneContainer';
import { PositronConnectionsView } from 'vs/workbench/contrib/positronConnections/browser/positronConnectionsView';


const positronConnectionsViewIcon = registerIcon(
	'positron-connections-view-icon',
	Codicon.database,
	nls.localize('positronConnectionsViewIcon', 'View icon of the Positron Connections view.')
);

const VIEW_CONTAINER = Registry.as<IViewContainersRegistry>(Extensions.ViewContainersRegistry).registerViewContainer(
	{
		id: POSITRON_CONNECTIONS_VIEW_ID,
		title: {
			value: nls.localize('positron.connections', "Connections Core"),
			original: 'Connections Core'
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
	// openCommandActionDescriptor: {
	// 	id: 'workbench.action.positron.openHelp',
	// 	keybindings: {
	// 		primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyH,
	// 	},
	// 	order: 1,
	// }
}], VIEW_CONTAINER);
