/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import '../browser/positronCanvas.contribution.css';
import { Codicon } from '../../../../base/common/codicons.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize, localize2 } from '../../../../nls.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IStorageService, StorageScope } from '../../../../platform/storage/common/storage.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IWorkspaceTrustEnablementService, IWorkspaceTrustManagementService, IWorkspaceTrustRequestService } from '../../../../platform/workspace/common/workspaceTrust.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IAuxiliaryWindowService } from '../../../services/auxiliaryWindow/browser/auxiliaryWindowService.js';
import { IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { INativeWorkbenchEnvironmentService } from '../../../services/environment/electron-browser/environmentService.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { ILifecycleService } from '../../../services/lifecycle/common/lifecycle.js';
import { IWorkbenchLayoutService } from '../../../services/layout/browser/layoutService.js';
import { windowLogId } from '../../../services/log/common/logConstants.js';
import { IOutputService } from '../../../services/output/common/output.js';
import { AI_ENABLED_KEY } from '../../positronAssistant/common/positronAIConfiguration.js';
import { CanvasStartupPresenter } from '../browser/canvasStartupPresenter.js';
import { registerCanvasCommandLockdown } from '../browser/positronCanvasCommandLockdown.js';
import { sweepRestoredCanvasWindows } from '../browser/positronCanvasRestore.js';
import { awaitWorkspaceTrustDecisionForCanvas } from '../browser/positronCanvasTrustGate.js';
import { CANVAS_EXIT_COMMAND_ID, CANVAS_MODE_STORAGE_KEY, CANVAS_OPEN_ON_STARTUP_KEY, CANVAS_WEBVIEW_VIEW_TYPE, CanvasEntryOutcome, ICanvasStartSignals, PositronCanvasModeActiveContext, shouldStartInCanvasMode } from '../common/positronCanvasMode.js';
import { IPositronCanvasService, PositronCanvasService } from './positronCanvasService.js';

registerSingleton(IPositronCanvasService, PositronCanvasService, InstantiationType.Delayed);

/**
 * Display label of Posit Assistant's output channel, matched at click time to
 * route "Show Logs" to the channel that explains a Canvas startup failure.
 * Part of the cross-repo seam (../README.md).
 */
const ASSISTANT_OUTPUT_CHANNEL_LABEL = 'Posit Assistant';

/**
 * Enters Canvas mode from a forwarded `--canvas` launch and the Canvas
 * editor's action bar. Same service call as `positron.canvas.enter`; this
 * action adds the presentation of not getting in. The assistant owns palette
 * discovery, so Positron stays dormant when the installed assistant does not
 * provide Canvas.
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
 * Leaves Canvas mode for the full IDE. Deliberately unbound (see ../README.md);
 * the user-facing way out is Canvas's own "Open Positron" control.
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
 * the user watches the IDE paint and restore first, and a startup failure
 * would have no usable IDE to notify into. Instantiated only for windows
 * actually booting into Canvas, so the boot path's services are not
 * constructed in every window of every launch.
 */
class CanvasStartupBoot extends Disposable {

	/**
	 * Set when the user cancels into the IDE while the entry callback is
	 * parked at one of its gates; see `enterFromStartup`.
	 */
	private cancelled = false;

	/**
	 * Latched once the trust gate has resolved: the decision holds for the
	 * session, and re-running the gate on a curtain Retry would wait out the
	 * full initiation grace again, reading as a hang.
	 */
	private trustDecisionSettled = false;

	constructor(
		@IPositronCanvasService private readonly canvasService: IPositronCanvasService,
		@IAuxiliaryWindowService private readonly auxiliaryWindowService: IAuxiliaryWindowService,
		@IEditorGroupsService private readonly editorGroupsService: IEditorGroupsService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IStorageService private readonly storageService: IStorageService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IOutputService private readonly outputService: IOutputService,
		@IHostService private readonly hostService: IHostService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IWorkspaceTrustEnablementService private readonly trustEnablementService: IWorkspaceTrustEnablementService,
		@IWorkspaceTrustManagementService private readonly trustManagementService: IWorkspaceTrustManagementService,
		@IWorkspaceTrustRequestService private readonly trustRequestService: IWorkspaceTrustRequestService,
		@ILifecycleService private readonly lifecycleService: ILifecycleService,
		@ILogService private readonly logService: ILogService
	) {
		super();

		const presenter = this._register(new CanvasStartupPresenter(
			this.layoutService.mainContainer,
			() => this.enterFromStartup(),
			() => this.recoverMainWindow(),
			() => this.showLogs(),
			() => this.hostService.shutdown(),
			this.logService
		));

		presenter.present();
	}

	private async enterFromStartup(): Promise<CanvasEntryOutcome> {
		// A Retry after a failed recovery must be able to enter again.
		this.cancelled = false;

		if (!this.trustDecisionSettled) {
			// The trust decision must land before Canvas covers the IDE; see
			// positronCanvasTrustGate.ts. The prompt shows over the curtain
			// (dialogs render above it) and the gate resolves on either answer.
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
			this.trustDecisionSettled = true;
		}

		// Wait for editors, not merely the restored phase (which races a
		// short timeout): entering early would find no restored Canvas panel
		// and create a second one.
		await this.editorGroupsService.whenRestored;

		// The gates above park this callback while the user can cancel into
		// the IDE; entering now would re-acquire the freed engagement and
		// hide the IDE seconds after the user asked for it.
		if (this.cancelled) {
			return {
				entered: false,
				reason: 'superseded',
				message: localize('positron.canvas.startupSuperseded', "Canvas stopped opening because Positron was asked for the IDE.")
			};
		}

		const outcome = await this.canvasService.enter();
		if (!outcome.entered) {
			// A restored Canvas window this entry never adopted must not stay
			// floating, chromeless, beside the IDE the user lands in.
			void this.sweepRestoredWindows();
		}
		return outcome;
	}

	private async recoverMainWindow(): Promise<void> {
		this.cancelled = true;
		await this.canvasService.exit();
		await this.sweepRestoredWindows();
	}

	private async sweepRestoredWindows(): Promise<void> {
		try {
			await sweepRestoredCanvasWindows({
				auxiliaryWindowService: this.auxiliaryWindowService,
				editorGroupsService: this.editorGroupsService,
				layoutService: this.layoutService,
				logService: this.logService
			});
		} catch (error) {
			this.logService.error('[canvas] Could not check for restored Canvas windows', error);
		}
	}

	/**
	 * Lands the user on the output that explains the failure: the assistant's
	 * channel when it registered one, the window log otherwise. Resolved at
	 * click time because the channel appears only once the extension has run.
	 */
	private async showLogs(): Promise<void> {
		const assistantChannel = this.outputService.getChannelDescriptors().find(descriptor => descriptor.label === ASSISTANT_OUTPUT_CHANNEL_LABEL);
		await this.outputService.showChannel(assistantChannel?.id ?? windowLogId);
	}
}

/**
 * Decides what a starting window does about Canvas: boot straight into it, or
 * make sure no restored Canvas window is left floating next to a plain IDE.
 * Runs at BlockRestore in every window, so it stays light; the boot machinery
 * hangs off `CanvasStartupBoot`.
 */
class PositronCanvasStartupContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'positron.canvas.startup';

	constructor(
		@IAuxiliaryWindowService auxiliaryWindowService: IAuxiliaryWindowService,
		@IEditorGroupsService editorGroupsService: IEditorGroupsService,
		@IConfigurationService configurationService: IConfigurationService,
		@INativeWorkbenchEnvironmentService environmentService: INativeWorkbenchEnvironmentService,
		@IInstantiationService instantiationService: IInstantiationService,
		@INotificationService notificationService: INotificationService,
		@IStorageService storageService: IStorageService,
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@ILogService logService: ILogService
	) {
		super();

		// `shouldStartInCanvasMode` owns the signals' precedence. The setting
		// comes from `inspect()` because an explicit `false` must override
		// the stored intent.
		const setting = configurationService.inspect<boolean>(CANVAS_OPEN_ON_STARTUP_KEY);
		const signals: ICanvasStartSignals = {
			aiEnabled: configurationService.getValue<boolean>(AI_ENABLED_KEY) !== false,
			engagedElsewhere: environmentService.standaloneModeEngagedElsewhere,
			canvasFlag: environmentService.args.canvas === true,
			configuredOpenOnStartup: setting.policyValue ?? setting.workspaceFolderValue ?? setting.workspaceValue ?? setting.userValue ?? setting.applicationValue,
			storedIntent: storageService.getBoolean(CANVAS_MODE_STORAGE_KEY, StorageScope.WORKSPACE, false)
		};

		// No await before this point: the curtain must be in the DOM before
		// the workbench paints, or the IDE flashes first.
		if (shouldStartInCanvasMode(signals)) {
			this._register(instantiationService.createInstance(CanvasStartupBoot));
			return;
		}

		// A stored intent this window declined to honor (setting or
		// ai.enabled veto) would boot a later launch into Canvas after the
		// veto lifts; clear it now. Not when engaged elsewhere: the intent
		// belongs to the window presenting this workspace's Canvas.
		if (signals.storedIntent && !signals.engagedElsewhere) {
			storageService.remove(CANVAS_MODE_STORAGE_KEY, StorageScope.WORKSPACE);
		}

		if (signals.canvasFlag) {
			// The flag was an explicit ask; a veto must not answer it with a
			// silent plain IDE window.
			notificationService.error(!signals.aiEnabled
				? localize('positron.canvas.flagAiDisabled', "Canvas is unavailable because AI features are disabled.")
				: localize('positron.canvas.flagEngagedElsewhere', "Canvas is already open in another Positron window."));
		}

		sweepRestoredCanvasWindows({ auxiliaryWindowService, editorGroupsService, layoutService, logService })
			.catch(error => logService.error('[canvas] Could not check for restored Canvas windows', error));
	}
}

registerWorkbenchContribution2(PositronCanvasStartupContribution.ID, PositronCanvasStartupContribution, WorkbenchPhase.BlockRestore);
