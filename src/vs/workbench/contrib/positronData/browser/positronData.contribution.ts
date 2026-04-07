/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from '../../../../nls.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { PositronDataViewPane } from './positronDataView.js';
import { ViewContainer, IViewContainersRegistry, ViewContainerLocation, Extensions as ViewContainerExtensions, IViewsRegistry } from '../../../common/views.js';

// The Positron data view ID.
const POSITRON_DATA_VIEW_ID = 'workbench.panel.positronData';

// The Positron data view icon.
const positronDataViewIcon = registerIcon(
	'positron-data-view-icon',
	Codicon.positronData,
	nls.localize('positronDataViewIcon', 'View icon of the Positron Data view.')
);

// Register the Positron data view container.
const VIEW_CONTAINER: ViewContainer = Registry.as<IViewContainersRegistry>(
	ViewContainerExtensions.ViewContainersRegistry
).registerViewContainer(
	{
		id: POSITRON_DATA_VIEW_ID,
		title: {
			value: nls.localize('positron.data', "Data"),
			original: 'Data'
		},
		icon: positronDataViewIcon,
		order: 2,
		ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [POSITRON_DATA_VIEW_ID, { mergeViewWithContainerWhenSingleView: true }]),
		storageId: POSITRON_DATA_VIEW_ID,
		hideIfEmpty: false,
	},
	ViewContainerLocation.Sidebar,
	{
		doNotRegisterOpenCommand: false,
		isDefault: false
	}
);

// Register the Positron data view.
Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry).registerViews([{
	id: POSITRON_DATA_VIEW_ID,
	name: {
		value: nls.localize('positron.data', "Data"),
		original: 'Data'
	},
	containerIcon: positronDataViewIcon,
	canMoveView: true,
	canToggleVisibility: false,
	ctorDescriptor: new SyncDescriptor(PositronDataViewPane),
	positronAlwaysOpenView: true,
	openCommandActionDescriptor: {
		id: 'workbench.action.positron.toggleData',
		mnemonicTitle: nls.localize({ key: 'miToggleData', comment: ['&& denotes a mnemonic'] }, "&&Data"),
		keybindings: {},
		order: 3,
	}
}], VIEW_CONTAINER);
