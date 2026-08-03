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
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IAuxiliaryWindowService } from '../../../services/auxiliaryWindow/browser/auxiliaryWindowService.js';
import { GroupsOrder, IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { INativeWorkbenchEnvironmentService } from '../../../services/environment/electron-browser/environmentService.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { AI_ENABLED_KEY } from '../../positronAssistant/common/positronAIConfiguration.js';
import { WebviewInput } from '../../webviewPanel/browser/webviewEditorInput.js';
import { CanvasStartupPresenter } from '../browser/canvasStartupPresenter.js';
import { registerCanvasCommandLockdown } from '../browser/positronCanvasCommandLockdown.js';
import { CANVAS_MODE_STORAGE_KEY, CANVAS_OPEN_ON_STARTUP_KEY, CANVAS_WEBVIEW_VIEW_TYPE, PositronCanvasModeActiveContext, shouldStartInCanvasMode } from '../common/positronCanvasMode.js';
import { IPositronCanvasService, PositronCanvasService } from './positronCanvasService.js';

registerSingleton(IPositronCanvasService, PositronCanvasService, InstantiationType.Delayed);

/**
 * Enters Canvas mode from a surface where the user is the audience: the
 * command palette, the forwarded `--canvas` launch, and the button on a
 * Canvas editor's action bar. Every entry point lands on the same service
 * call, so there is one definition of what Canvas mode is and how to get into
 * it; what this action adds is the presentation of not getting in.
 */
class OpenCanvasAction extends Action2 {

	static readonly ID = 'positron.canvas.open';

	constructor() {
		super({
			id: OpenCanvasAction.ID,
			title: localize2('positron.canvas.open', "Open Canvas"),
			category: Categories.View,
			f1: true,
			precondition: ContextKeyExpr.has(`config.${AI_ENABLED_KEY}`),
			icon: Codicon.screenFull,
			menu: [{
				// The action bar of an editor group whose active editor is a
				// Canvas panel: a Canvas sitting as an ordinary tab in the IDE
				// is exactly the state this action resolves. The standard
				// move-into-new-window button is suppressed there in its favor
				// (editorActionBarFactory.tsx), since a plain detached editor
				// window is the degraded shape of what this opens.
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
			// A notification, not the startup curtain: the user asked for Canvas
			// from inside a working IDE, and covering that IDE with a full-window
			// failure card offering "Open Positron" and "Quit" would answer a
			// question they did not ask.
			notificationService.error(outcome.message);
		}
	}
}

/**
 * Leaves Canvas mode for the full IDE.
 *
 * Deliberately carries no default keybinding: Escape is pressed constantly in
 * a chat UI to dismiss popovers, and a chord that silently swaps the whole
 * product surface underneath the user is worse than no shortcut. The way out
 * is the Canvas top bar's own "Open Positron" control (and this action in the
 * command palette).
 */
class ExitCanvasModeAction extends Action2 {

	static readonly ID = 'positron.canvas.exit';

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
 * Posit Assistant's way into Canvas mode. A plain command rather than an
 * `Action2` because its contract is an API's, not a UI affordance's: it
 * returns the entry outcome to the caller and never notifies, so the assistant
 * can decide how a non-entry should be presented. The palette and the
 * forwarded launch go through `positron.canvas.open`, which owns the
 * notification instead.
 */
CommandsRegistry.registerCommand('positron.canvas.enter', (accessor: ServicesAccessor) => {
	return accessor.get(IPositronCanvasService).enter();
});

/**
 * Lets Posit Assistant ask whether it is being shown as the whole product, so
 * the Canvas UI can offer its way back to the IDE only when there is one to go
 * back to. A plain command rather than an `Action2`: it answers a question and
 * has nothing to do in a command palette.
 */
CommandsRegistry.registerCommand('positron.canvas.isActive', (accessor: ServicesAccessor): boolean => {
	return accessor.get(IPositronCanvasService).isActive;
});

/**
 * Gates `shouldStartInCanvasMode` on two window-level vetoes that beat every
 * entry signal. `ai.enabled` off means Canvas must not activate the assistant
 * that switch exists to keep off; the AI gate inside
 * `PositronCanvasService.doEnter` only fires once entry is already behind the
 * curtain, and the curtain's exit clears stored intent but not the configured
 * setting, so without this check a Canvas workspace with AI disabled would
 * show the curtain and its "AI features are disabled" failure card on every
 * single launch. Canvas engaged in another window means this window entering
 * too would put a second Canvas surface on screen; Canvas is one product
 * surface per application instance, and stored intent is shared between
 * windows on the same workspace identity, so a new window would otherwise
 * re-enter on its own. Extracted to a free function so the gate is testable
 * without instantiating `PositronCanvasStartupContribution`, which has DOM
 * side effects.
 */
export function shouldPresentCanvasStartupCurtain(aiEnabled: boolean, engagedElsewhere: boolean, canvasFlag: boolean, configuredOpenOnStartup: boolean | undefined, storedIntent: boolean): boolean {
	if (!aiEnabled || engagedElsewhere) {
		return false;
	}
	return shouldStartInCanvasMode(canvasFlag, configuredOpenOnStartup, storedIntent);
}

/**
 * Boots the window straight into Canvas mode when asked to, so that Canvas can
 * be the product someone launches rather than something they navigate to.
 *
 * A launch into Canvas is presented behind a curtain: without it the user
 * watches the full IDE paint and sit there for the seconds it takes to restore
 * editors and activate the assistant, which is the opposite of "Canvas is the
 * only product surface you see". The curtain is also where a startup failure
 * lands, since there is no usable IDE behind it to notify into.
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
		@ILogService private readonly logService: ILogService
	) {
		super();

		// Everything up to appending the curtain element stays synchronous. This
		// contribution runs at BlockRestore precisely so it can get in front of
		// the workbench; a single await before the element is in the DOM hands
		// the frame back and reintroduces the IDE flash the curtain exists to
		// prevent.
		if (this.shouldStartInCanvasMode()) {
			this.startInCanvasMode();
		} else {
			this.dropRestoredCanvasWindows();
		}
	}

	/**
	 * A window that boots into the IDE must not come up with a live Canvas
	 * window beside it. The Canvas window is an ordinary auxiliary editor part
	 * as far as layout restore is concerned, so a session that quit in Canvas
	 * mode restores one even when `shouldStartInCanvasMode` said no -- the exact
	 * case `canvas.openOnStartup: false` exists for. Merge such a window's
	 * Canvas back into the IDE as an inline tab: the conversation survives,
	 * matching what an explicit exit does, and the emptied window closes itself.
	 *
	 * A window is recognized by what Canvas mode made it, not by what it
	 * shows: only Canvas mode opens auxiliary windows with the `lockCompact`
	 * trait, and the trait survives restore, so it answers "did Canvas mode
	 * create this window?" for windows born in an earlier session. A Canvas
	 * panel the user popped out by hand lives in an ordinary auxiliary window
	 * without the trait and is left exactly where they put it.
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
					// Unlock first so the group is an ordinary group for as long
					// as it survives the merge, the way an explicit exit does.
					group.lock(false);
					this.editorGroupsService.mergeGroup(group, this.editorGroupsService.mainPart.activeGroup);
				}
				merged = true;
			}

			if (merged) {
				// The editor area auto-hides when it has no editors, and a merge
				// into a hidden editor area would leave the Canvas tab invisible.
				this.layoutService.setPartHidden(false, Parts.EDITOR_PART);
			}
		})().catch(error => this.logService.error('[canvas] Could not check for restored Canvas windows', error));
	}

	/**
	 * The flag is for launching into Canvas once; the setting is for a workspace
	 * that is a Canvas workspace; the stored intent is for a workspace that was
	 * in Canvas mode when it last stopped, which is what makes "relaunch into
	 * whatever you quit in" true. `shouldStartInCanvasMode` owns their
	 * precedence. Exit still writes no configuration: it clears the stored
	 * intent, so leaving Canvas is remembered without changing what the
	 * workspace is configured to boot into.
	 */
	private shouldStartInCanvasMode(): boolean {
		const setting = this.configurationService.inspect<boolean>(CANVAS_OPEN_ON_STARTUP_KEY);
		return shouldPresentCanvasStartupCurtain(
			// Read live rather than cache: `ai.enabled` toggles without a window
			// reload, and it has to hold even for a workspace configured to boot
			// into Canvas -- otherwise the curtain would appear, find AI disabled
			// only once behind it (PositronCanvasService.doEnter), and show its
			// failure card on every single launch with nothing to clear the loop.
			this.configurationService.getValue<boolean>(AI_ENABLED_KEY) !== false,
			this.environmentService.canvasModeEngagedElsewhere,
			this.environmentService.args.canvas === true,
			setting.policyValue ?? setting.workspaceFolderValue ?? setting.workspaceValue ?? setting.userValue ?? setting.applicationValue,
			this.storageService.getBoolean(CANVAS_MODE_STORAGE_KEY, StorageScope.WORKSPACE, false)
		);
	}

	private startInCanvasMode(): void {
		const presenter = this._register(new CanvasStartupPresenter(
			this.layoutService.mainContainer,
			async () => {
				// Wait for editors to be restored, not merely for the workbench to
				// reach its restored phase: that phase races a short timeout while
				// a real restore takes far longer, and entering early would find no
				// restored Canvas panel and create a second one.
				await this.editorGroupsService.whenRestored;
				return this.canvasService.enter();
			},
			// Exit is the whole of "Open Positron": it clears the durable intent,
			// so the next launch comes back to the IDE, and its IDE-restoring
			// steps are safe no-ops when Canvas never came up at all.
			() => this.canvasService.exit().then(() => undefined),
			() => this.hostService.shutdown(),
			this.logService
		));

		presenter.present();
	}
}

registerWorkbenchContribution2(PositronCanvasStartupContribution.ID, PositronCanvasStartupContribution, WorkbenchPhase.BlockRestore);
