/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize, localize2 } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IViewContainersRegistry, IViewDescriptor, IViewDescriptorService, IViewsRegistry, ViewContainer, ViewContainerLocation, Extensions as ViewExtensions } from '../../../common/views.js';
import { isSimplifiedLayoutEnabled } from '../../../services/positronLayout/common/positronSimplifiedLayoutConfiguration.js';

/** The Tools container in the secondary side bar. */
export const POSITRON_TOOLS_VIEW_CONTAINER_ID = 'workbench.view.positronTools';

/**
 * The containers whose views move into Tools: Problems, Output, Debug Console,
 * Ports, Run and Debug, and Testing. The simplified layout hides these
 * containers, so without the move their views could not be opened at all.
 * Remote Explorer stays hidden: its views only work inside its own container,
 * which shows the targets for one kind of remote at a time.
 */
const CONTAINERS_MOVED_TO_TOOLS: ReadonlySet<string> = new Set([
	'workbench.panel.markers',
	'workbench.panel.output',
	'workbench.panel.repl',
	'~remote.forwardedPortsContainer',
	'workbench.view.debug',
	'workbench.view.extension.test',
]);

/**
 * The views already collapsed on their first arrival in Tools. After that, the
 * user's own expanded or collapsed choice sticks.
 */
const COLLAPSED_VIEWS_STORAGE_KEY = 'positron.tools.collapsedViews';

const positronToolsViewIcon = registerIcon(
	'positron-tools-view-icon',
	Codicon.tools,
	localize('positron.toolsViewIcon', "View icon of the Tools view container.")
);

/**
 * In the simplified layout, gathers the views from the hidden bottom panel and
 * activity bar containers into one Tools container in the secondary side bar.
 * The views stay out of the way, but users can still find them.
 *
 * It changes each view's default container rather than moving the view for the
 * user, so nothing is saved to the profile, and applying a layout keeps the
 * views in Tools. Each view starts collapsed, so Tools opens as a list of names.
 */
export class PositronToolsContainerContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.positronToolsContainer';

	constructor(
		@IConfigurationService configurationService: IConfigurationService,
		@IStorageService storageService: IStorageService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
	) {
		super();

		if (!isSimplifiedLayoutEnabled(configurationService)) {
			return;
		}

		const viewContainersRegistry = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry);
		const viewsRegistry = Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry);

		const toolsContainer = viewContainersRegistry.registerViewContainer(
			{
				id: POSITRON_TOOLS_VIEW_CONTAINER_ID,
				title: localize2('positron.tools', "Tools"),
				icon: positronToolsViewIcon,
				order: 100,
				ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [POSITRON_TOOLS_VIEW_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: true }]),
				storageId: POSITRON_TOOLS_VIEW_CONTAINER_ID,
				hideIfEmpty: true,
			},
			ViewContainerLocation.AuxiliaryBar,
		);

		const collapsedViews = new Set<string>(JSON.parse(storageService.get(COLLAPSED_VIEWS_STORAGE_KEY, StorageScope.PROFILE, '[]')));

		const moveToTools = (views: IViewDescriptor[], from: ViewContainer) => {
			if (!CONTAINERS_MOVED_TO_TOOLS.has(from.id) || !views.length) {
				return;
			}
			viewsRegistry.moveViews(views, toolsContainer);

			const toCollapse = views.filter(view => !collapsedViews.has(view.id));
			if (!toCollapse.length) {
				return;
			}
			const model = viewDescriptorService.getViewContainerModel(toolsContainer);
			for (const view of toCollapse) {
				// A view the user already moved somewhere else is not in Tools.
				if (model.allViewDescriptors.some(descriptor => descriptor.id === view.id)) {
					model.setCollapsed(view.id, true);
				}
				collapsedViews.add(view.id);
			}
			storageService.store(COLLAPSED_VIEWS_STORAGE_KEY, JSON.stringify([...collapsedViews]), StorageScope.PROFILE, StorageTarget.USER);
		};

		// Views already registered.
		for (const container of viewContainersRegistry.all) {
			moveToTools([...viewsRegistry.getViews(container)], container);
		}

		// Views registered later: Ports appears once port forwarding turns on, and
		// extensions add Testing views.
		this._register(viewsRegistry.onViewsRegistered(registered => {
			for (const { views, viewContainer } of registered) {
				moveToTools(views, viewContainer);
			}
		}));
	}
}
