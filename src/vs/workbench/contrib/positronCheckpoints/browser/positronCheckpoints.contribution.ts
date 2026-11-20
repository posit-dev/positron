/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './checkpointsMessages.js';
import './syncController.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { EditorExtensions } from '../../../common/editor.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IViewContainersRegistry, IViewsRegistry, Extensions as ViewContainerExtensions, ViewContainerLocation, ViewContentGroups } from '../../../common/views.js';
import { IActivityService, NumberBadge } from '../../../services/activity/common/activity.js';
import { registerCheckpointsConfiguration } from '../common/checkpointsConfiguration.js';
import { Strings } from '../common/checkpointsStrings.js';
import { CheckpointsContentProvider } from './checkpointsContentProvider.js';
import { ICheckpointsSuggestionService } from './checkpointsSuggestionService.js';
import { TaskChangeWatcher } from './taskChangeWatcher.js';
import { SharedCopyChecker } from './sharedCopyChecker.js';
import { PositronCheckpointsView } from './positronCheckpointsView.js';
import { OverlapEditorPane } from './overlapEditor/overlapEditor.js';
import { OverlapEditorInput } from './overlapEditor/overlapEditorInput.js';
import { showJoinDialog } from './components/joinDialog.js';

/** The id of the Explorer view that shows while no folder is open. */
const EXPLORER_EMPTY_VIEW_ID = 'workbench.explorer.emptyView';

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

/**
 * Shows a badge of 1 on the Checkpoints icon of the activity bar while a checkpoint suggestion is
 * open (spec 7.1). The badge is the only sign of a suggestion outside the view.
 */
export class CheckpointsSuggestionBadge extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.positronCheckpointsSuggestionBadge';

	private readonly _badge = this._register(new MutableDisposable());

	constructor(
		@ICheckpointsSuggestionService suggestionService: ICheckpointsSuggestionService,
		@IActivityService activityService: IActivityService,
	) {
		super();
		const update = () => {
			if (!suggestionService.current) {
				this._badge.clear();
			} else if (!this._badge.value) {
				this._badge.value = activityService.showViewContainerActivity(POSITRON_CHECKPOINTS_VIEW_CONTAINER_ID, {
					badge: new NumberBadge(1, () => Strings.suggestions.badge()),
				});
			}
		};
		this._register(suggestionService.onDidChange(update));
		update();
	}
}

registerWorkbenchContribution2(CheckpointsContentProvider.ID, CheckpointsContentProvider, WorkbenchPhase.AfterRestored);
registerWorkbenchContribution2(SharedCopyChecker.ID, SharedCopyChecker, WorkbenchPhase.AfterRestored);
registerWorkbenchContribution2(TaskChangeWatcher.ID, TaskChangeWatcher, WorkbenchPhase.AfterRestored);
registerWorkbenchContribution2(CheckpointsSuggestionBadge.ID, CheckpointsSuggestionBadge, WorkbenchPhase.AfterRestored);

// The overlap editor. Its input has no serializer, so it is not restored after a restart.
Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(OverlapEditorPane, OverlapEditorInput.EditorID, Strings.overlaps.editorLabel()),
	[new SyncDescriptor(OverlapEditorInput)]
);

export const JOIN_PROJECT_COMMAND_ID = 'positronCheckpoints.joinProject';

/** Opens the dialog that copies a colleague's project to this computer from its link. */
registerAction2(class JoinProjectAction extends Action2 {
	constructor() {
		super({
			id: JOIN_PROJECT_COMMAND_ID,
			title: localize2('positron.checkpoints.joinProject', "Join a Project"),
			category: title,
			f1: true,
		});
	}

	run(): void {
		showJoinDialog();
	}
});

// The Checkpoints view needs an open folder, so a window with no folder shows the Join a Project
// button in the welcome text of the Explorer.
Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry).registerViewWelcomeContent(EXPLORER_EMPTY_VIEW_ID, {
	content: localize('positron.checkpoints.joinProjectWelcome', "To work on a project a colleague shared with you:\n[{0}](command:{1})", Strings.join.action(), JOIN_PROJECT_COMMAND_ID),
	when: ContextKeyExpr.equals('workbenchState', 'empty'),
	group: ViewContentGroups.Open,
	order: 3,
});
