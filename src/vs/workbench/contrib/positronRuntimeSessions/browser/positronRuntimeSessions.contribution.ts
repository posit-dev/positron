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
import { Action2, registerAction2 } from 'vs/platform/actions/common/actions';
import { Categories } from 'vs/platform/action/common/actionCommonCategories';
import { ServicesAccessor } from 'vs/editor/browser/editorExtensions';

// The Positron sessions view identifier.
export const POSITRON_RUNTIME_SESSIONS_VIEW_ID = 'workbench.panel.positronSessions';

// The Positron sessions view icon.
const positronRuntimeSessionsViewIcon = registerIcon(
	'positron-runtime-sessions-view-icon',
	Codicon.versions,
	nls.localize('positronRuntimeSessionsViewIcon', 'View icon of the Positron sessions view.')
);

/**
 * This command is used to open the (otherwise hidden) Runtime Sessions view.
 * Since this view is intended only for developers, we hide it behind this
 * command.
 */
registerAction2(class extends Action2 {

	constructor() {
		super({
			id: 'workbench.action.openRuntimeSessionsView',
			title: nls.localize2('openRuntimeSessionsView', 'Open Runtime Sessions View'),
			category: Categories.View,
			f1: true
		});
	}

	run(_accessor: ServicesAccessor): void {
		// Register the Positron sessions view container.
		const VIEW_CONTAINER: ViewContainer = Registry.as<IViewContainersRegistry>(
			ViewContainerExtensions.ViewContainersRegistry
		).registerViewContainer(
			{
				id: POSITRON_RUNTIME_SESSIONS_VIEW_ID,
				title: {
					value: nls.localize('positron.view.runtime.view', "Runtimes"),
					original: 'Runtimes'
				},
				icon: positronRuntimeSessionsViewIcon,
				order: 10,
				ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [POSITRON_RUNTIME_SESSIONS_VIEW_ID, { mergeViewWithContainerWhenSingleView: true }]),
				storageId: POSITRON_RUNTIME_SESSIONS_VIEW_ID,
				hideIfEmpty: true,
			},
			ViewContainerLocation.AuxiliaryBar,
			{
				doNotRegisterOpenCommand: false,
				isDefault: true
			}
		);

		// Register the Positron sessions view.
		Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry).registerViews(
			[
				{
					id: POSITRON_RUNTIME_SESSIONS_VIEW_ID,
					name: {
						value: nls.localize('positron.view.runtime.sessions', "Sessions"),
						original: 'Sessions'
					},
					ctorDescriptor: new SyncDescriptor(PositronRuntimeSessionsViewPane),
					canToggleVisibility: true,
					hideByDefault: false,
					canMoveView: true,
					containerIcon: positronRuntimeSessionsViewIcon,
					openCommandActionDescriptor: {
						id: 'workbench.action.positron.toggleSessions',
						mnemonicTitle: nls.localize({ key: 'miToggleSessions', comment: ['&& denotes a mnemonic'] }, "&&Sessions"),
						order: 1,
					}
				}
			],
			VIEW_CONTAINER
		);
	}
});


