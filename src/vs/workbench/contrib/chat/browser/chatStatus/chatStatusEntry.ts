/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/chatStatus.css';
import { Disposable, DisposableStore, MutableDisposable } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { IWorkbenchContribution } from '../../../../common/contributions.js';
import { IStatusbarEntry, IStatusbarEntryAccessor, IStatusbarService, ShowTooltipCommand, StatusbarAlignment, StatusbarEntryKind } from '../../../../services/statusbar/browser/statusbar.js';
import { ChatEntitlement, ChatEntitlementService, IChatEntitlementService, isProUser } from '../../../../services/chat/common/chatEntitlementService.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { getCodeEditor } from '../../../../../editor/browser/editorBrowser.js';
import { IInlineCompletionsService } from '../../../../../editor/browser/services/inlineCompletionsService.js';
import { IChatSessionsService } from '../../common/chatSessionsService.js';
import { ChatStatusDashboard } from './chatStatusDashboard.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import { disposableWindowInterval } from '../../../../../base/browser/dom.js';
import { isNewUser } from './chatStatus.js';
import product from '../../../../../platform/product/common/product.js';
import { isCompletionsEnabled } from '../../../../../editor/common/services/completionsEnablement.js';
import { ChatConfiguration } from '../../common/constants.js';
// --- Start Positron ---
import { AI_ENABLED_KEY } from '../../../positronAssistant/common/positronAIConfiguration.js';
// GitHub Copilot's provider enable setting (declared in the authentication
// extension's package.json). When false, Copilot is off, so the status shows
// the disabled state rather than "Signed out"/"Finish Setup". Literal because
// the setting is owned by an extension, not a workbench constant.
const COPILOT_PROVIDER_ENABLE_KEY = 'positron.assistant.provider.githubCopilot.enable';
// --- End Positron ---

export class ChatStatusBarEntry extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.chatStatusBarEntry';

	private entry: IStatusbarEntryAccessor | undefined = undefined;

	private readonly activeCodeEditorListener = this._register(new MutableDisposable());

	private runningSessionsCount: number;

	constructor(
		@IChatEntitlementService private readonly chatEntitlementService: ChatEntitlementService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IStatusbarService private readonly statusbarService: IStatusbarService,
		@IEditorService private readonly editorService: IEditorService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IInlineCompletionsService private readonly completionsService: IInlineCompletionsService,
		@IChatSessionsService private readonly chatSessionsService: IChatSessionsService,
	) {
		super();

		this.runningSessionsCount = this.chatSessionsService.getInProgress().reduce((total, item) => total + item.count, 0);

		this.update();

		this.registerListeners();
	}

	private update(): void {
		const sentiment = this.chatEntitlementService.sentiment;
		// --- Start Positron ---
		// When chat is hidden only because of `chat.disableAIFeatures`, keep the
		// status entry so the user can still see and control inline completions.
		// `isCompletionsOnlyMode` already implies `sentiment.hidden`, so we don't
		// re-check it here.
		/*
		if (!sentiment.hidden) {
			const props = this.getEntryProps();
		*/
		const completionsOnly = this.chatEntitlementService.isCompletionsOnlyMode;
		if (!sentiment.hidden || completionsOnly) {
			const props = this.getEntryProps(completionsOnly);
			// --- End Positron ---
			if (this.entry) {
				this.entry.update(props);
			} else {
				this.entry = this.statusbarService.addEntry(props, 'chat.statusBarEntry', StatusbarAlignment.RIGHT, { location: { id: 'status.editor.mode', priority: 100.1 }, alignment: StatusbarAlignment.RIGHT });
			}
		} else {
			this.entry?.dispose();
			this.entry = undefined;
		}
	}

	private registerListeners(): void {
		this._register(this.chatEntitlementService.onDidChangeQuotaExceeded(() => this.update()));
		this._register(this.chatEntitlementService.onDidChangeSentiment(() => this.update()));
		this._register(this.chatEntitlementService.onDidChangeEntitlement(() => this.update()));

		this._register(this.completionsService.onDidChangeIsSnoozing(() => this.update()));

		this._register(this.chatSessionsService.onDidChangeInProgress(() => {
			const oldSessionsCount = this.runningSessionsCount;
			this.runningSessionsCount = this.chatSessionsService.getInProgress().reduce((total, item) => total + item.count, 0);
			if (this.runningSessionsCount !== oldSessionsCount) {
				this.update();
			}
		}));

		this._register(this.editorService.onDidActiveEditorChange(() => this.onDidActiveEditorChange()));

		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(product.defaultChatAgent?.completionsEnablementSetting) || e.affectsConfiguration(ChatConfiguration.SignInTitleBarEnabled)
				// --- Start Positron ---
				// Toggling either the chat-hiding setting or the AI main switch adds or
				// removes the completions-only entry, so re-run without a reload.
				// Toggling the GitHub Copilot provider changes the disabled state below.
				|| e.affectsConfiguration(ChatConfiguration.AIDisabled) || e.affectsConfiguration(AI_ENABLED_KEY)
				|| e.affectsConfiguration(COPILOT_PROVIDER_ENABLE_KEY)
				// --- End Positron ---
			) {
				this.update();
			}
		}));
	}

	private onDidActiveEditorChange(): void {
		this.update();

		this.activeCodeEditorListener.clear();

		// Listen to language changes in the active code editor
		const activeCodeEditor = getCodeEditor(this.editorService.activeTextEditorControl);
		if (activeCodeEditor) {
			this.activeCodeEditorListener.value = activeCodeEditor.onDidChangeModelLanguage(() => {
				this.update();
			});
		}
	}

	// --- Start Positron ---
	// `completionsOnly` gates out the chat-specific states below when chat is
	// hidden but inline completions stay available.
	private getEntryProps(completionsOnly = false): IStatusbarEntry {
		// --- End Positron ---
		let text = '$(copilot)';
		let ariaLabel = localize('chatStatusAria', "Copilot status");
		let kind: StatusbarEntryKind | undefined;

		// --- Start Positron ---
		// When the GitHub Copilot provider is disabled, Copilot (chat and inline
		// completions) is off, so show the disabled state below rather than a
		// sign-in/entitlement state ("Signed out", "Finish Setup"), which would be
		// misleading.
		const copilotProviderDisabled = this.configurationService.getValue(COPILOT_PROVIDER_ENABLE_KEY) === false;
		// --- End Positron ---

		// --- Start Positron ---
		// In completions-only mode chat is hidden, so skip the chat-specific states
		// (Finish Setup) and keep only the completions-relevant ones below. Also skip
		// it when the Copilot provider is disabled (handled by the disabled state).
		if (!completionsOnly && !copilotProviderDisabled && isNewUser(this.chatEntitlementService)) {
			// --- End Positron ---
			const entitlement = this.chatEntitlementService.entitlement;

			// Finish Setup
			if (
				this.chatEntitlementService.sentiment.later ||	// user skipped setup
				entitlement === ChatEntitlement.Available ||	// user is entitled
				isProUser(entitlement) ||						// user is already pro
				entitlement === ChatEntitlement.Free			// user is already free
			) {
				const finishSetup = localize('finishSetup', "Finish Setup");

				text = `$(copilot) ${finishSetup}`;
				ariaLabel = finishSetup;
				kind = 'prominent';
			}
		} else {
			const chatQuotaExceeded = this.chatEntitlementService.quotas.chat?.percentRemaining === 0;
			const completionsQuotaExceeded = this.chatEntitlementService.quotas.completions?.percentRemaining === 0;

			// Disabled
			// --- Start Positron ---
			// `copilotProviderDisabled` added: the Copilot provider being off maps to
			// the disabled state, and (being first) takes precedence over the
			// signed-out and quota states below.
			if (copilotProviderDisabled || this.chatEntitlementService.sentiment.disabled || this.chatEntitlementService.sentiment.untrusted) {
				// --- End Positron ---
				text = '$(copilot-unavailable)';
				ariaLabel = localize('copilotDisabledStatus', "Copilot disabled");
			}

			// Sessions in progress
			// --- Start Positron ---
			// Chat-specific state; skipped in completions-only mode.
			else if (!completionsOnly && this.runningSessionsCount > 0) {
				// --- End Positron ---
				text = '$(copilot-in-progress)';
				if (this.runningSessionsCount > 1) {
					ariaLabel = localize('chatSessionsInProgressStatus', "{0} agent sessions in progress", this.runningSessionsCount);
				} else {
					ariaLabel = localize('chatSessionInProgressStatus', "1 agent session in progress");
				}
			}

			// Signed out
			else if (this.chatEntitlementService.entitlement === ChatEntitlement.Unknown) {
				const signInExperiment = this.configurationService.getValue<boolean>(ChatConfiguration.SignInTitleBarEnabled);
				if (signInExperiment) {
					const signIn = localize('signIn', "Sign In");
					text = `$(copilot) ${signIn}`;
					ariaLabel = signIn;
				} else {
					const signedOut = localize('notSignedIn', "Signed out");
					text = `${this.chatEntitlementService.anonymous ? '$(copilot)' : '$(copilot-not-connected)'} ${signedOut}`;
					ariaLabel = signedOut;
					kind = 'prominent';
				}
			}

			// Free Quota Exceeded
			// --- Start Positron ---
			// In completions-only mode only the completions quota matters, not chat quota.
			/*
			else if (this.chatEntitlementService.entitlement === ChatEntitlement.Free && (chatQuotaExceeded || completionsQuotaExceeded)) {
			*/
			else if (this.chatEntitlementService.entitlement === ChatEntitlement.Free && (completionsOnly ? completionsQuotaExceeded : (chatQuotaExceeded || completionsQuotaExceeded))) {
				// --- End Positron ---
				let quotaWarning: string;
				if (chatQuotaExceeded && !completionsQuotaExceeded) {
					quotaWarning = localize('chatQuotaExceededStatus', "Chat quota reached");
				} else if (completionsQuotaExceeded && !chatQuotaExceeded) {
					quotaWarning = localize('completionsQuotaExceededStatus', "Inline suggestions quota reached");
				} else {
					quotaWarning = localize('chatAndCompletionsQuotaExceededStatus', "Quota reached");
				}

				text = `$(copilot-warning) ${quotaWarning}`;
				ariaLabel = quotaWarning;
				kind = 'prominent';
			}

			// Completions Disabled
			else if (this.editorService.activeTextEditorLanguageId && !isCompletionsEnabled(this.configurationService, this.editorService.activeTextEditorLanguageId)) {
				text = '$(copilot-unavailable)';
				ariaLabel = localize('completionsDisabledStatus', "Inline suggestions disabled");
			}

			// Completions Snoozed
			else if (this.completionsService.isSnoozing()) {
				text = '$(copilot-snooze)';
				ariaLabel = localize('completionsSnoozedStatus', "Inline suggestions snoozed");
			}
		}

		const baseResult = {
			name: localize('chatStatus', "Copilot Status"),
			text,
			ariaLabel,
			command: ShowTooltipCommand,
			showInAllWindows: true,
			kind,
			tooltip: {
				element: (token: CancellationToken) => {
					const store = new DisposableStore();
					store.add(token.onCancellationRequested(() => {
						store.dispose();
					}));
					// --- Start Positron ---
					// In completions-only mode, suppress the chat usage/setup rows and
					// keep the completions controls (settings, model, snooze, quota).
					/*
					const elem = ChatStatusDashboard.instantiateInContents(this.instantiationService, store, undefined);
					*/
					const dashboardOptions = completionsOnly ? { disableChatSections: true } : undefined;
					const elem = ChatStatusDashboard.instantiateInContents(this.instantiationService, store, dashboardOptions);
					// --- End Positron ---

					// todo@connor4312/@benibenj: workaround for #257923
					store.add(disposableWindowInterval(mainWindow, () => {
						if (!elem.isConnected) {
							store.dispose();
						}
					}, 2000));

					return elem;
				}
			}
		} satisfies IStatusbarEntry;

		return baseResult;
	}

	override dispose(): void {
		super.dispose();

		this.entry?.dispose();
		this.entry = undefined;
	}
}
