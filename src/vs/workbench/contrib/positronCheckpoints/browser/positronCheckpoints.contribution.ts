/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './checkpointsMessages.js';
import './syncController.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { EditorExtensions } from '../../../common/editor.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IViewContainersRegistry, IViewsRegistry, Extensions as ViewContainerExtensions, ViewContainerLocation } from '../../../common/views.js';
import { registerCheckpointsConfiguration } from '../common/checkpointsConfiguration.js';
import { Strings } from '../common/checkpointsStrings.js';
import { CheckpointsContentProvider } from './checkpointsContentProvider.js';
import { PositronCheckpointsView } from './positronCheckpointsView.js';
import { OverlapEditorPane } from './overlapEditor/overlapEditor.js';
import { OverlapEditorInput } from './overlapEditor/overlapEditorInput.js';

export const POSITRON_CHECKPOINTS_VIEW_CONTAINER_ID = 'workbench.view.positronCheckpoints';
export const POSITRON_CHECKPOINTS_VIEW_ID = 'workbench.view.positronCheckpoints.main';

const checkpointsViewIcon = registerIcon('positron-checkpoints-view-icon', Codicon.history, Strings.view.iconDescription());

const title = { value: Strings.view.title(), original: 'Checkpoints' };

const viewContainer = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry).registerViewContainer({
	id: POSITRON_CHECKPOINTS_VIEW_CONTAINER_ID,
	title,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [POSITRON_CHECKPOINTS_VIEW_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: true }]),
	storageId: 'workbench.positronCheckpoints.views.state',
	icon: checkpointsViewIcon,
	alwaysUseContainerInfo: true,
	hideIfEmpty: true,
	order: 52,
}, ViewContainerLocation.Sidebar, { isDefault: false });

Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry).registerViews(
	[
		{
			id: POSITRON_CHECKPOINTS_VIEW_ID,
			name: title,
			ctorDescriptor: new SyncDescriptor(PositronCheckpointsView),
			canToggleVisibility: false,
			canMoveView: true,
			containerIcon: checkpointsViewIcon,
			when: ContextKeyExpr.greater('workspaceFolderCount', 0),
			focusCommand: {
				id: `${POSITRON_CHECKPOINTS_VIEW_ID}.focus`,
			},
		}
	],
	viewContainer
);

registerCheckpointsConfiguration();

registerWorkbenchContribution2(CheckpointsContentProvider.ID, CheckpointsContentProvider, WorkbenchPhase.AfterRestored);

// The overlap editor. Its input has no serializer, so it is not restored after a restart.
Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(OverlapEditorPane, OverlapEditorInput.EditorID, Strings.overlaps.editorLabel()),
	[new SyncDescriptor(OverlapEditorInput)]
);
