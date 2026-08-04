/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import '../browser/positronCanvas.contribution.css';
import { Codicon } from '../../../../base/common/codicons.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize2 } from '../../../../nls.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IStorageService, StorageScope } from '../../../../platform/storage/common/storage.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IWorkspaceTrustEnablementService, IWorkspaceTrustManagementService, IWorkspaceTrustRequestService } from '../../../../platform/workspace/common/workspaceTrust.js';
import { prepareMoveCopyEditors } from '../../../browser/parts/editor/editor.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IAuxiliaryWindowService } from '../../../services/auxiliaryWindow/browser/auxiliaryWindowService.js';
import { GroupsOrder, IEditorGroup, IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { INativeWorkbenchEnvironmentService } from '../../../services/environment/electron-browser/environmentService.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { ILifecycleService } from '../../../services/lifecycle/common/lifecycle.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { AI_ENABLED_KEY } from '../../positronAssistant/common/positronAIConfiguration.js';
import { WebviewInput } from '../../webviewPanel/browser/webviewEditorInput.js';
import { CanvasStartupPresenter } from '../browser/canvasStartupPresenter.js';
import { registerCanvasCommandLockdown } from '../browser/positronCanvasCommandLockdown.js';
import { awaitWorkspaceTrustDecisionForCanvas } from '../browser/positronCanvasTrustGate.js';
import { CANVAS_EXIT_COMMAND_ID, CANVAS_MODE_STORAGE_KEY, CANVAS_OPEN_ON_STARTUP_KEY, CANVAS_WEBVIEW_VIEW_TYPE, PositronCanvasModeActiveContext, shouldStartInCanvasMode } from '../common/positronCanvasMode.js';
import { IPositronCanvasService, PositronCanvasService } from './positronCanvasService.js';

registerSingleton(IPositronCanvasService, PositronCanvasService, InstantiationType.Delayed);

export function mergeRestoredCanvasGroup(group: IEditorGroup, target: IEditorGroup, editorGroupsService: IEditorGroupsService): void {
	group.lock(false);
	if (!editorGroupsService.mergeGroup(group, target)) {
		group.moveEditors(prepareMoveCopyEditors(group, group.editors.slice()), target);
	}
}

/**
 * Enters Canvas mode from a forwarded `--canvas` launch and the Canvas editor's
 * action bar. The assistant owns palette discovery, so Positron stays dormant
 * when the installed assistant does not provide Canvas. Both entry points land
 * on the same service call; this action adds the presentation of not getting in.
 */
class OpenCanvasAction extends Action2 {

	static readonly ID = 'positron.canvas.open';

	constructor() {
		super({
			id: OpenCanvasAction.ID,
			title: localize2('positron.canvas.open', "Open Canvas"),
			category: Categories.View,
			f1: false,
			precondition: ContextKeyExpr.has(`config.${AI_ENABLED_KEY}`),
			icon: Codicon.screenFull,
			menu: [{
				// Shown where the active editor is a Canvas panel, in place of
				// the standard move-into-new-window button, which is suppressed
				// for Canvas (editorActionBarFactory.tsx).
				id: MenuId.EditorActionsRight,
				group: 'navigation',
				when: ContextKeyExpr.and(
					ContextKeyExpr.equals('activeWebviewPanelId', CANVAS_WEBVIEW_VIEW_TYPE),
					ContextKeyExpr.has(`config.${AI_ENABLED_KEY}`)
				)
			}]
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const canvasService = accessor.get(IPositronCanvasService);
		const notificationService = accessor.get(INotificationService);
		const outcome = await canvasService.enter();
		if (!outcome.entered) {
			// A notification, not the startup curtain: the user asked from
			// inside a working IDE.
			notificationService.error(outcome.message);
		}
	}
}

/**
 * Leaves Canvas mode for the full IDE. Deliberately unbound: Escape is pressed
 * constantly in a chat UI, and a chord that swaps the whole product surface is
 * worse than no shortcut. The way out is Canvas's own "Open Positron" control.
 */
class ExitCanvasModeAction extends Action2 {

	static readonly ID = CANVAS_EXIT_COMMAND_ID;

	constructor() {
		super({
			id: ExitCanvasModeAction.ID,
			title: localize2('positron.canvas.exit', "Exit Canvas to the Positron IDE"),
			category: Categories.View,
			f1: true,
			precondition: PositronCanvasModeActiveContext
		});
	}

	override run(accessor: ServicesAccessor): Promise<boolean> {
		return accessor.get(IPositronCanvasService).exit();
	}
}

registerAction2(OpenCanvasAction);
registerAction2(ExitCanvasModeAction);
registerCanvasCommandLockdown();

/**
 * Posit Assistant's way into Canvas mode. A plain command: it returns the
 * entry outcome and never notifies, so the caller decides the presentation.
 */
CommandsRegistry.registerCommand('positron.canvas.enter', (accessor: ServicesAccessor) => {
	return accessor.get(IPositronCanvasService).enter();
});

/**
 * Whether Canvas is being shown as the whole product; gates the Canvas UI's
 * "Open Positron" control.
 */
CommandsRegistry.registerCommand('positron.canvas.isActive', (accessor: ServicesAccessor): boolean => {
	return accessor.get(IPositronCanvasService).isActive;
});

/**
 * Boots the window straight into Canvas mode, behind a curtain: without one
 * the user watches the IDE paint and restore for seconds first, and a startup
 * failure would have no usable IDE to notify into.
 */
class PositronCanvasStartupContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'positron.canvas.startup';

	constructor(
		@IPositronCanvasService private readonly canvasService: IPositronCanvasService,
		@IAuxiliaryWindowService private readonly auxiliaryWindowService: IAuxiliaryWindowService,
		@IEditorGroupsService private readonly editorGroupsService: IEditorGroupsService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@INativeWorkbenchEnvironmentService private readonly environmentService: INativeWorkbenchEnvironmentService,
		@IStorageService private readonly storageService: IStorageService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IHostService private readonly hostService: IHostService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IWorkspaceTrustEnablementService private readonly trustEnablementService: IWorkspaceTrustEnablementService,
		@IWorkspaceTrustManagementService private readonly trustManagementService: IWorkspaceTrustManagementService,
		@IWorkspaceTrustRequestService private readonly trustRequestService: IWorkspaceTrustRequestService,
		@ILifecycleService private readonly lifecycleService: ILifecycleService,
		@ILogService private readonly logService: ILogService
	) {
		super();

		// Runs at BlockRestore to get in front of the workbench; a single
		// await before the curtain element is in the DOM reintroduces the IDE
		// flash it exists to prevent.
		if (this.shouldBootIntoCanvasMode()) {
			this.startInCanvasMode();
		} else {
			this.dropRestoredCanvasWindows();
		}
	}

	/**
	 * A window booting into the IDE must not come up with a live Canvas window
	 * beside it, yet layout restore brings one back whenever the session quit
	 * in Canvas mode. Merge such a window's Canvas back into the IDE as an
	 * inline tab (the conversation survives; the emptied window closes
	 * itself). Recognized by the `lockCompact` trait, which only Canvas mode
	 * sets and which survives restore -- a Canvas panel the user popped out by
	 * hand lacks the trait and is left where they put it.
	 */
	private dropRestoredCanvasWindows(): void {
		(async () => {
			await this.editorGroupsService.whenRestored;

			let merged = false;
			for (const part of this.editorGroupsService.parts) {
				if (part === this.editorGroupsService.mainPart) {
					continue;
				}
				if (this.auxiliaryWindowService.getWindow(part.windowId)?.createState().lockCompact !== true) {
					continue;
				}
				const groups = part.getGroups(GroupsOrder.MOST_RECENTLY_ACTIVE);
				const editors = groups.flatMap(group => group.editors);
				if (editors.length === 0 || !editors.every(editor => editor instanceof WebviewInput && editor.providerId === CANVAS_WEBVIEW_VIEW_TYPE)) {
					continue;
				}
				this.logService.info('[canvas] Merging a restored Canvas window back into the IDE: Canvas mode is not engaged');
				for (const group of groups) {
					mergeRestoredCanvasGroup(group, this.editorGroupsService.mainPart.activeGroup, this.editorGroupsService);
				}
				merged = true;
			}

			if (merged) {
				// A merge into an auto-hidden editor area would leave the
				// Canvas tab invisible.
				this.layoutService.setPartHidden(false, Parts.EDITOR_PART);
			}
		})().catch(error => this.logService.error('[canvas] Could not check for restored Canvas windows', error));
	}

	/**
	 * Flag: launch into Canvas once. Setting: a Canvas workspace. Stored
	 * intent: the workspace was in Canvas mode when it last stopped.
	 * `shouldStartInCanvasMode` owns their precedence; exit clears only the
	 * stored intent, never the configuration.
	 */
	private shouldBootIntoCanvasMode(): boolean {
		const setting = this.configurationService.inspect<boolean>(CANVAS_OPEN_ON_STARTUP_KEY);
		return shouldStartInCanvasMode({
			// Read live: `ai.enabled` toggles without a window reload.
			aiEnabled: this.configurationService.getValue<boolean>(AI_ENABLED_KEY) !== false,
			engagedElsewhere: this.environmentService.standaloneModeEngagedElsewhere,
			canvasFlag: this.environmentService.args.canvas === true,
			configuredOpenOnStartup: setting.policyValue ?? setting.workspaceFolderValue ?? setting.workspaceValue ?? setting.userValue ?? setting.applicationValue,
			storedIntent: this.storageService.getBoolean(CANVAS_MODE_STORAGE_KEY, StorageScope.WORKSPACE, false)
		});
	}

	private startInCanvasMode(): void {
		const presenter = this._register(new CanvasStartupPresenter(
			this.layoutService.mainContainer,
			async () => {
				// The workspace trust decision must land before Canvas covers
				// the IDE: the trust startup prompt renders in this main
				// window, which Canvas mode minimizes, and an undecided
				// workspace holds back trust-gated extensions - including the
				// auth providers behind the Canvas model picker. The prompt
				// shows over the curtain (dialogs render above it) and the
				// gate resolves on either answer.
				await awaitWorkspaceTrustDecisionForCanvas({
					configurationService: this.configurationService,
					contextService: this.contextService,
					hostService: this.hostService,
					lifecycleService: this.lifecycleService,
					storageService: this.storageService,
					trustEnablementService: this.trustEnablementService,
					trustManagementService: this.trustManagementService,
					trustRequestService: this.trustRequestService
				});
				// Wait for editors, not merely the restored phase (which races
				// a short timeout): entering early would find no restored
				// Canvas panel and create a second one.
				await this.editorGroupsService.whenRestored;
				return this.canvasService.enter();
			},
			// Exit is the whole of "Open Positron": it clears the durable
			// intent, and its IDE-restoring steps are safe no-ops when Canvas
			// never came up.
			() => this.canvasService.exit().then(() => undefined),
			() => this.hostService.shutdown(),
			this.logService
		));

		presenter.present();
	}
}

registerWorkbenchContribution2(PositronCanvasStartupContribution.ID, PositronCanvasStartupContribution, WorkbenchPhase.BlockRestore);
