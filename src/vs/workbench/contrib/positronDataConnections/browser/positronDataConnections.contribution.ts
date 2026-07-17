/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import './positronDataConnectionsCommands.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { PositronDataViewPane } from './positronDataConnectionsView.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { POSITRON_DATA_CONNECTIONS_ENABLED_KEY } from './positronDataConnectionsConfiguration.js';
import { IWorkbenchContribution, WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { ViewContainer, IViewContainersRegistry, ViewContainerLocation, Extensions as ViewContainerExtensions, IViewsRegistry } from '../../../common/views.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';

// The Positron data connections view ID.
const POSITRON_DATA_CONNECTIONS_VIEW_ID = 'workbench.panel.positronDataConnections';

// Register the configuration setting.
Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'positron',
	order: 7,
	title: localize('positronConfigurationTitle', "Positron"),
	type: 'object',
	properties: {
		[POSITRON_DATA_CONNECTIONS_ENABLED_KEY]: {
			type: 'boolean',
			default: false,
			markdownDescription: localize(
				'positron.dataConnections.enabled',
				'Enable the Data Connections panel. Requires a reload to take effect.'
			),
			tags: ['preview'],
			scope: ConfigurationScope.APPLICATION,
			included: true,
		},
	},
});

// Workbench contribution that conditionally registers the Data Connections
// view container and view when the feature flag is enabled. Toggling the
// setting requires a reload.
class PositronDataConnectionsContribution implements IWorkbenchContribution {
	// Contribution ID used for telemetry and debugging.
	static readonly ID = 'workbench.contrib.positronDataConnections';

	/**
	 * Constructor that registers the Data Connections view container and view if the feature flag
	 * is enabled.
	 */
	constructor(@IConfigurationService configurationService: IConfigurationService) {
		// Check if the Positron Data Connections feature is enabled before registering the view
		// container and view. Return early if the feature is disabled.
		if (!configurationService.getValue<boolean>(POSITRON_DATA_CONNECTIONS_ENABLED_KEY)) {
			return;
		}

		// Register the icon for the Positron Data Connections view.
		const positronDataConnectionsViewIcon = registerIcon(
			'positron-data-connections-view-icon',
			Codicon.positronDataConnections,
			localize('positronDataConnectionsViewIcon', 'View icon of the Data Connections view.')
		);

		// Register the Positron data connections view container.
		const VIEW_CONTAINER: ViewContainer = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry).registerViewContainer(
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
				mnemonicTitle: localize({ key: 'miToggleDataConnections', comment: ['&& denotes a mnemonic'] }, "&&Data"),
				keybindings: {},
				order: 3,
			}
		}], VIEW_CONTAINER);
	}
}

// Register the workbench contribution.
registerWorkbenchContribution2(
	PositronDataConnectionsContribution.ID,
	PositronDataConnectionsContribution,
	WorkbenchPhase.BlockStartup,
);
