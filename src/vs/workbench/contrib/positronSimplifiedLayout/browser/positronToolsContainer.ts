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
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IViewContainersRegistry, IViewDescriptor, IViewDescriptorService, IViewsRegistry, ViewContainer, ViewContainerLocation, Extensions as ViewExtensions } from '../../../common/views.js';
import { IPositronLayoutService } from '../../../services/positronLayout/browser/interfaces/positronLayoutService.js';
import { isSimplifiedLayoutEnabled } from '../../../services/positronLayout/common/positronSimplifiedLayoutConfiguration.js';

/** The Tools container in the secondary side bar. */
export const POSITRON_TOOLS_VIEW_CONTAINER_ID = 'workbench.view.positronTools';

/**
 * The containers whose views move into Tools: Problems, Output, Debug Console,
 * Ports, Run and Debug, and Testing. The simplified layout hides these
 * containers in task layouts, so without the move their views could not be
 * opened at all.
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

const positronToolsViewIcon = registerIcon(
	'positron-tools-view-icon',
	Codicon.tools,
	localize('positron.toolsViewIcon', "View icon of the Tools view container.")
);

/**
 * In the simplified layout, gathers the views from the hidden bottom panel and
 * activity bar containers into one Tools container in the secondary side bar,
 * while a task layout is applied. The views stay out of the way, but users can
 * still find them. The Default layout shows every view where it normally lives,
 * so applying it moves the views back.
 *
 * It changes each view's default container rather than moving the view for the
 * user, so nothing is saved to the profile, and applying a layout keeps the
 * views where they are.
 *
 * Each window starts with every view in Tools collapsed, so Tools opens as a
 * list of names. Changing a view's default container expands it, so the
 * expanded or collapsed state a user picks lasts only until the next window.
 */
export class PositronToolsContainerContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.positronToolsContainer';

	/** The container each view in Tools came from, so it can go back. */
	private readonly _originalContainers = new Map<string, { view: IViewDescriptor; container: ViewContainer }>();

	constructor(
		@IConfigurationService configurationService: IConfigurationService,
		@IViewDescriptorService private readonly _viewDescriptorService: IViewDescriptorService,
		@IPositronLayoutService positronLayoutService: IPositronLayoutService,
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

		const moveToTools = (views: readonly IViewDescriptor[], from: ViewContainer) => {
			if (!CONTAINERS_MOVED_TO_TOOLS.has(from.id) || !views.length) {
				return;
			}
			for (const view of views) {
				this._originalContainers.set(view.id, { view, container: from });
			}
			viewsRegistry.moveViews([...views], toolsContainer);

			const model = this._viewDescriptorService.getViewContainerModel(toolsContainer);
			for (const view of views) {
				// A view the user already moved somewhere else is not in Tools.
				if (model.allViewDescriptors.some(descriptor => descriptor.id === view.id)) {
					model.setCollapsed(view.id, true);
				}
			}
		};

		const moveAllToTools = () => {
			for (const container of viewContainersRegistry.all) {
				moveToTools(viewsRegistry.getViews(container), container);
			}
		};

		const moveAllBack = () => {
			const byContainer = new Map<ViewContainer, IViewDescriptor[]>();
			for (const { view, container } of this._originalContainers.values()) {
				byContainer.set(container, [...(byContainer.get(container) ?? []), view]);
			}
			this._originalContainers.clear();
			for (const [container, views] of byContainer) {
				viewsRegistry.moveViews(views, container);
			}
		};

		if (!positronLayoutService.showsAllViews) {
			moveAllToTools();
		}

		this._register(positronLayoutService.onDidChangeShowsAllViews(showsAllViews => {
			if (showsAllViews) {
				moveAllBack();
			} else {
				moveAllToTools();
			}
		}));

		// Views registered later: Ports appears once port forwarding turns on, and
		// extensions add Testing views.
		this._register(viewsRegistry.onViewsRegistered(registered => {
			if (positronLayoutService.showsAllViews) {
				return;
			}
			for (const { views, viewContainer } of registered) {
				moveToTools(views, viewContainer);
			}
		}));
	}
}
