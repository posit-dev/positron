/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/chatStatus.css';
import { safeIntl } from '../../../../base/common/date.js';
import { Disposable, DisposableStore, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { language } from '../../../../base/common/platform.js';
import { localize } from '../../../../nls.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IStatusbarEntry, IStatusbarEntryAccessor, IStatusbarService, ShowTooltipCommand, StatusbarAlignment, StatusbarEntryKind } from '../../../services/statusbar/browser/statusbar.js';
import { $, addDisposableListener, append, clearNode, disposableWindowInterval, EventHelper, EventType, getWindow } from '../../../../base/browser/dom.js';
import { ChatEntitlement, ChatEntitlementService, IChatEntitlementService, IQuotaSnapshot, isProUser } from '../../../services/chat/common/chatEntitlementService.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { defaultButtonStyles, defaultCheckboxStyles } from '../../../../platform/theme/browser/defaultStyles.js';
import { Checkbox } from '../../../../base/browser/ui/toggle/toggle.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { Lazy } from '../../../../base/common/lazy.js';
import { contrastBorder, inputValidationErrorBorder, inputValidationInfoBorder, inputValidationWarningBorder, registerColor, transparent } from '../../../../platform/theme/common/colorRegistry.js';
import { IHoverService, nativeHoverDelegate } from '../../../../platform/hover/browser/hover.js';
import { Color } from '../../../../base/common/color.js';
import { Gesture, EventType as TouchEventType } from '../../../../base/browser/touch.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import product from '../../../../platform/product/common/product.js';
import { isObject } from '../../../../base/common/types.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { Button } from '../../../../base/browser/ui/button/button.js';
import { renderLabelWithIcons } from '../../../../base/browser/ui/iconLabel/iconLabels.js';
import { WorkbenchActionExecutedEvent, WorkbenchActionExecutedClassification, IAction, toAction } from '../../../../base/common/actions.js';
import { parseLinkedText } from '../../../../base/common/linkedText.js';
import { Link } from '../../../../platform/opener/browser/link.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IChatStatusItemService, ChatStatusEntry } from './chatStatusItemService.js';
import { ITextResourceConfigurationService } from '../../../../editor/common/services/textResourceConfiguration.js';
import { EditorResourceAccessor, SideBySideEditor } from '../../../common/editor.js';
import { getCodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { ActionBar } from '../../../../base/browser/ui/actionbar/actionbar.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { URI } from '../../../../base/common/uri.js';
import { IInlineCompletionsService } from '../../../../editor/browser/services/inlineCompletionsService.js';
import { IChatSessionsService } from '../common/chatSessionsService.js';
import { IMarkdownRendererService } from '../../../../platform/markdown/browser/markdownRenderer.js';
import { MarkdownString } from '../../../../base/common/htmlContent.js';
import { AGENT_SESSIONS_VIEWLET_ID } from '../common/constants.js';

// --- Start Positron ---
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { ILanguageModelsService } from '../common/languageModels.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IEditorGroupsService, IEditorPart } from '../../../services/editor/common/editorGroupsService.js';
import { ChatContextKeys } from '../common/chatContextKeys.js';
// --- End Positron ---

const gaugeForeground = registerColor('gauge.foreground', {
	dark: inputValidationInfoBorder,
	light: inputValidationInfoBorder,
	hcDark: contrastBorder,
	hcLight: contrastBorder
}, localize('gaugeForeground', "Gauge foreground color."));

registerColor('gauge.background', {
	dark: transparent(gaugeForeground, 0.3),
	light: transparent(gaugeForeground, 0.3),
	hcDark: Color.white,
	hcLight: Color.white
}, localize('gaugeBackground', "Gauge background color."));

registerColor('gauge.border', {
	dark: null,
	light: null,
	hcDark: contrastBorder,
	hcLight: contrastBorder
}, localize('gaugeBorder', "Gauge border color."));

const gaugeWarningForeground = registerColor('gauge.warningForeground', {
	dark: inputValidationWarningBorder,
	light: inputValidationWarningBorder,
	hcDark: contrastBorder,
	hcLight: contrastBorder
}, localize('gaugeWarningForeground', "Gauge warning foreground color."));

registerColor('gauge.warningBackground', {
	dark: transparent(gaugeWarningForeground, 0.3),
	light: transparent(gaugeWarningForeground, 0.3),
	hcDark: Color.white,
	hcLight: Color.white
}, localize('gaugeWarningBackground', "Gauge warning background color."));

const gaugeErrorForeground = registerColor('gauge.errorForeground', {
	dark: inputValidationErrorBorder,
	light: inputValidationErrorBorder,
	hcDark: contrastBorder,
	hcLight: contrastBorder
}, localize('gaugeErrorForeground', "Gauge error foreground color."));

registerColor('gauge.errorBackground', {
	dark: transparent(gaugeErrorForeground, 0.3),
	light: transparent(gaugeErrorForeground, 0.3),
	hcDark: Color.white,
	hcLight: Color.white
}, localize('gaugeErrorBackground', "Gauge error background color."));

//#endregion

const defaultChat = {
	completionsEnablementSetting: product.defaultChatAgent?.completionsEnablementSetting ?? '',
	nextEditSuggestionsSetting: product.defaultChatAgent?.nextEditSuggestionsSetting ?? '',
	manageSettingsUrl: product.defaultChatAgent?.manageSettingsUrl ?? '',
	manageOverageUrl: product.defaultChatAgent?.manageOverageUrl ?? '',
	provider: product.defaultChatAgent?.provider ?? { default: { id: '', name: '' }, enterprise: { id: '', name: '' }, apple: { id: '', name: '' }, google: { id: '', name: '' } },
	termsStatementUrl: product.defaultChatAgent?.termsStatementUrl ?? '',
	privacyStatementUrl: product.defaultChatAgent?.privacyStatementUrl ?? ''
};

// --- Start Positron ---
// This is a wrapper around the ChatStatus class
// which creates a ChatStatus instance for each editor part (window)\
// See src/vs/workbench/contrib/languageStatus/browser/languageStatus.ts for inspiration
export class ChatStatusBarEntry extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.chatStatusBarEntry';

	constructor(
		@IEditorGroupsService private readonly editorGroupService: IEditorGroupsService,
	) {
		super();

		for (const part of editorGroupService.parts) {
			this.createChatStatus(part);
		}

		this._register(editorGroupService.onDidCreateAuxiliaryEditorPart(part => this.createChatStatus(part)));
	}

	private createChatStatus(part: IEditorPart): void {
		const disposables = new DisposableStore();
		this._register(
			part.onWillDispose(() => {
				if (!disposables.isDisposed) {
					disposables.dispose();
				}
			})
		);

		const scopedInstantiationService = this.editorGroupService.getScopedInstantiationService(part);
		disposables.add(scopedInstantiationService.createInstance(ChatStatus));
	}
}

// Rename this class to avoid needing to modify other files that import it

// export class ChatStatusBarEntry extends Disposable implements IWorkbenchContribution {
export class ChatStatus extends Disposable {
	// --- End Positron ---

	static readonly ID = 'workbench.contrib.chatStatusBarEntry';

	private entry: IStatusbarEntryAccessor | undefined = undefined;

	private dashboard = new Lazy<ChatStatusDashboard>(() => this.instantiationService.createInstance(ChatStatusDashboard));

	private readonly activeCodeEditorListener = this._register(new MutableDisposable());

	constructor(
		// --- Start Positron ---
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		// --- End Positron ---
		@IChatEntitlementService private readonly chatEntitlementService: ChatEntitlementService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IStatusbarService private readonly statusbarService: IStatusbarService,
		@IEditorService private readonly editorService: IEditorService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IInlineCompletionsService private readonly completionsService: IInlineCompletionsService,
		@IChatSessionsService private readonly chatSessionsService: IChatSessionsService,
	) {
		super();

		this.update();
		this.registerListeners();
	}

	private update(): void {
		// --- Start Positron ---
		// Remove the Chat status if the active editor is not a code editor
		if (!this.shouldShowStatus()) {
			this.entry?.dispose();
			this.entry = undefined;
			return;
		}

		// We only need the part that displays the status. No need to hide it based on the chat entitlement setting the right context keys
		/*
		const sentiment = this.chatEntitlementService.sentiment;
		*/
		// Removed outer if (!sentiment.hidden) ...
		const props = this.getEntryProps();
		if (this.entry) {
			this.entry.update(props);
		} else {
			this.entry = this.statusbarService.addEntry(props, 'chat.statusBarEntry', StatusbarAlignment.RIGHT, { location: { id: 'status.editor.mode', priority: 100.1 }, alignment: StatusbarAlignment.RIGHT });
		}
		// --- End Positron ---
	}

	private registerListeners(): void {
		this._register(this.chatEntitlementService.onDidChangeQuotaExceeded(() => this.update()));
		this._register(this.chatEntitlementService.onDidChangeSentiment(() => this.update()));
		this._register(this.chatEntitlementService.onDidChangeEntitlement(() => this.update()));
		this._register(this.completionsService.onDidChangeIsSnoozing(() => this.update()));
		this._register(this.chatSessionsService.onDidChangeInProgress(() => this.update()));

		this._register(this.editorService.onDidActiveEditorChange(() => this.onDidActiveEditorChange()));

		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(defaultChat.completionsEnablementSetting)) {
				this.update();
			}
		}));
		// --- Start Positron ---
		this._register(this.contextKeyService.onDidChangeContext(e => {
			const expr = ChatContextKeys.inChatSession.isEqualTo(true);
			if (e.affectsSome(new Set(expr.keys()))) {
				this.update();
			}
		}));
		// --- End Positron ---
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
	private shouldShowStatus(): boolean {
		// Hide the Chat status item if:
		// - only plot or data explorer editors are open, and
		// - the user is not in a chat session
		const inChat = ChatContextKeys.inChatSession.getValue(this.contextKeyService);
		const isEditor = !this.editorService.editors.every(editor => {
			return editor.editorId === 'workbench.editor.positronPlots' ||
				editor.editorId === 'workbench.editor.positronDataExplorer';
		});
		return inChat || isEditor;
	}
	// --- End Positron ---

	private getEntryProps(): IStatusbarEntry {
		// --- Start Positron ---
		let text = '$(positron-assistant)';
		let ariaLabel = localize('chatStatus', "Assistant Status");
		// --- End Positron ---
		let kind: StatusbarEntryKind | undefined;

		if (isNewUser(this.chatEntitlementService)) {
			const entitlement = this.chatEntitlementService.entitlement;

			// Finish Setup
			if (
				this.chatEntitlementService.sentiment.later ||	// user skipped setup
				entitlement === ChatEntitlement.Available ||	// user is entitled
				isProUser(entitlement) ||						// user is already pro
				entitlement === ChatEntitlement.Free			// user is already free
			) {
				const finishSetup = localize('finishSetup', "Finish Setup");

				// --- Start Positron ---
				// text = `$(copilot) ${finishSetup}`;
				// --- End Positron ---
				ariaLabel = finishSetup;
				kind = 'prominent';
			}
		} else {
			const chatQuotaExceeded = this.chatEntitlementService.quotas.chat?.percentRemaining === 0;
			const completionsQuotaExceeded = this.chatEntitlementService.quotas.completions?.percentRemaining === 0;
			const chatSessionsInProgressCount = this.chatSessionsService.getInProgress().reduce((total, item) => total + item.count, 0);

			// Disabled
			if (this.chatEntitlementService.sentiment.disabled || this.chatEntitlementService.sentiment.untrusted) {
				// --- Start Positron ---
				// text = '$(copilot-unavailable)';
				// --- End Positron ---
				ariaLabel = localize('copilotDisabledStatus', "Copilot disabled");
			}

			// Sessions in progress
			else if (chatSessionsInProgressCount > 0) {
				// --- Start Positron ---
				// text = '$(copilot-in-progress)';
				// --- End Positron ---
				if (chatSessionsInProgressCount > 1) {
					ariaLabel = localize('chatSessionsInProgressStatus', "{0} agent sessions in progress", chatSessionsInProgressCount);
				} else {
					ariaLabel = localize('chatSessionInProgressStatus', "1 agent session in progress");
				}
			}

			// --- Start Positron ---
			// Dial back the treatment of 'signed out' a little bit, since
			// everyone is going to be 'signed out' by default unless they are
			// signed in to Copilot
			// Signed out
			else if (this.chatEntitlementService.entitlement === ChatEntitlement.Unknown) {
				const signedOutWarning = localize('notSignedIn', "Signed out");

				// text = `${this.chatEntitlementService.anonymous ? '$(copilot)' : '$(copilot-not-connected)'} ${signedOutWarning}`;
				// --- Start Positron ---
				// text = `$(copilot-not-connected)`;
				// --- End Positron ---
				ariaLabel = signedOutWarning;
				// kind = 'prominent';
			}
			// --- End Positron ---

			// Free Quota Exceeded
			else if (this.chatEntitlementService.entitlement === ChatEntitlement.Free && (chatQuotaExceeded || completionsQuotaExceeded)) {
				let quotaWarning: string;
				if (chatQuotaExceeded && !completionsQuotaExceeded) {
					quotaWarning = localize('chatQuotaExceededStatus', "Chat quota reached");
				} else if (completionsQuotaExceeded && !chatQuotaExceeded) {
					quotaWarning = localize('completionsQuotaExceededStatus', "Inline suggestions quota reached");
				} else {
					quotaWarning = localize('chatAndCompletionsQuotaExceededStatus', "Quota reached");
				}

				// --- Start Positron ---
				// text = `$(copilot-warning) ${quotaWarning}`;
				// --- End Positron ---
				ariaLabel = quotaWarning;
				kind = 'prominent';
			}

			// Completions Disabled
			else if (this.editorService.activeTextEditorLanguageId && !isCompletionsEnabled(this.configurationService, this.editorService.activeTextEditorLanguageId)) {
				// --- Start Positron ---
				// text = '$(copilot-unavailable)';
				// --- End Positron ---
				ariaLabel = localize('completionsDisabledStatus', "Inline suggestions disabled");
			}

			// Completions Snoozed
			else if (this.completionsService.isSnoozing()) {
				// --- Start Positron ---
				// text = '$(copilot-snooze)';
				// --- End Positron ---
				ariaLabel = localize('completionsSnoozedStatus', "Inline suggestions snoozed");
			}
		}

		const baseResult = {
			// --- Start Positron ---
			name: localize('positronChatStatus', "Assistant Status"),
			text,
			ariaLabel,
			command: ShowTooltipCommand,
			// Do not show status in all windows; allows us to create a new status item
			// for each window manually
			// showInAllWindows: true,
			// --- End Positron ---
			kind,
			tooltip: { element: (token: CancellationToken) => this.dashboard.value.show(token) }
		};

		return baseResult;
	}

	override dispose(): void {
		super.dispose();

		this.entry?.dispose();
		this.entry = undefined;
	}
}

function isNewUser(chatEntitlementService: IChatEntitlementService): boolean {
	return !chatEntitlementService.sentiment.installed ||					// chat not installed
		chatEntitlementService.entitlement === ChatEntitlement.Available;	// not yet signed up to chat
}

function canUseChat(chatEntitlementService: IChatEntitlementService): boolean {
	if (!chatEntitlementService.sentiment.installed || chatEntitlementService.sentiment.disabled || chatEntitlementService.sentiment.untrusted) {
		return false; // chat not installed or not enabled
	}

	if (chatEntitlementService.entitlement === ChatEntitlement.Unknown || chatEntitlementService.entitlement === ChatEntitlement.Available) {
		return chatEntitlementService.anonymous; // signed out or not-yet-signed-up users can only use Chat if anonymous access is allowed
	}

	if (chatEntitlementService.entitlement === ChatEntitlement.Free && chatEntitlementService.quotas.chat?.percentRemaining === 0 && chatEntitlementService.quotas.completions?.percentRemaining === 0) {
		return false; // free user with no quota left
	}

	return true;
}

function isCompletionsEnabled(configurationService: IConfigurationService, modeId: string = '*'): boolean {
	const result = configurationService.getValue<Record<string, boolean>>(defaultChat.completionsEnablementSetting);
	if (!isObject(result)) {
		return false;
	}

	if (typeof result[modeId] !== 'undefined') {
		return Boolean(result[modeId]); // go with setting if explicitly defined
	}

	return Boolean(result['*']); // fallback to global setting otherwise
}

interface ISettingsAccessor {
	readSetting: () => boolean;
	writeSetting: (value: boolean) => Promise<void>;
}

type ChatSettingChangedClassification = {
	owner: 'bpasero';
	comment: 'Provides insight into chat settings changed from the chat status entry.';
	settingIdentifier: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The identifier of the setting that changed.' };
	settingMode?: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The optional editor language for which the setting changed.' };
	settingEnablement: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'Whether the setting got enabled or disabled.' };
};
type ChatSettingChangedEvent = {
	settingIdentifier: string;
	settingMode?: string;
	settingEnablement: 'enabled' | 'disabled';
};

class ChatStatusDashboard extends Disposable {

	private readonly element = $('div.chat-status-bar-entry-tooltip');

	private readonly dateFormatter = safeIntl.DateTimeFormat(language, { year: 'numeric', month: 'long', day: 'numeric' });
	private readonly dateTimeFormatter = safeIntl.DateTimeFormat(language, { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: 'numeric' });
	private readonly quotaPercentageFormatter = safeIntl.NumberFormat(undefined, { maximumFractionDigits: 1, minimumFractionDigits: 0 });
	private readonly quotaOverageFormatter = safeIntl.NumberFormat(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 0 });

	private readonly entryDisposables = this._register(new MutableDisposable());

	constructor(
		// --- Start Positron ---
		@ILanguageFeaturesService private readonly languageFeaturesService: ILanguageFeaturesService,
		@ILanguageModelsService private readonly languageModelsService: ILanguageModelsService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		// --- End Positron ---
		@IChatEntitlementService private readonly chatEntitlementService: ChatEntitlementService,
		@IChatStatusItemService private readonly chatStatusItemService: IChatStatusItemService,
		@ICommandService private readonly commandService: ICommandService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IEditorService private readonly editorService: IEditorService,
		@IHoverService private readonly hoverService: IHoverService,
		@ILanguageService private readonly languageService: ILanguageService,
		@IOpenerService private readonly openerService: IOpenerService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@ITextResourceConfigurationService private readonly textResourceConfigurationService: ITextResourceConfigurationService,
		@IInlineCompletionsService private readonly inlineCompletionsService: IInlineCompletionsService,
		@IChatSessionsService private readonly chatSessionsService: IChatSessionsService,
		@IMarkdownRendererService private readonly markdownRendererService: IMarkdownRendererService,
	) {
		super();
	}

	show(token: CancellationToken): HTMLElement {
		clearNode(this.element);

		const disposables = this.entryDisposables.value = new DisposableStore();
		disposables.add(token.onCancellationRequested(() => disposables.dispose()));

		let needsSeparator = false;
		const addSeparator = (label?: string, action?: IAction) => {
			if (needsSeparator) {
				this.element.appendChild($('hr'));
			}

			if (label || action) {
				this.renderHeader(this.element, disposables, label ?? '', action);
			}

			needsSeparator = true;
		};

		// Quota Indicator
		const { chat: chatQuota, completions: completionsQuota, premiumChat: premiumChatQuota, resetDate, resetDateHasTime } = this.chatEntitlementService.quotas;
		if (chatQuota || completionsQuota || premiumChatQuota) {

			addSeparator(localize('usageTitle', "Copilot Usage"), toAction({
				id: 'workbench.action.manageCopilot',
				label: localize('quotaLabel', "Manage Chat"),
				tooltip: localize('quotaTooltip', "Manage Chat"),
				class: ThemeIcon.asClassName(Codicon.settings),
				run: () => this.runCommandAndClose(() => this.openerService.open(URI.parse(defaultChat.manageSettingsUrl))),
			}));

			const completionsQuotaIndicator = completionsQuota && (completionsQuota.total > 0 || completionsQuota.unlimited) ? this.createQuotaIndicator(this.element, disposables, completionsQuota, localize('completionsLabel', "Inline Suggestions"), false) : undefined;
			const chatQuotaIndicator = chatQuota && (chatQuota.total > 0 || chatQuota.unlimited) ? this.createQuotaIndicator(this.element, disposables, chatQuota, localize('chatsLabel', "Chat messages"), false) : undefined;
			const premiumChatQuotaIndicator = premiumChatQuota && (premiumChatQuota.total > 0 || premiumChatQuota.unlimited) ? this.createQuotaIndicator(this.element, disposables, premiumChatQuota, localize('premiumChatsLabel', "Premium requests"), true) : undefined;

			if (resetDate) {
				this.element.appendChild($('div.description', undefined, localize('limitQuota', "Allowance resets {0}.", resetDateHasTime ? this.dateTimeFormatter.value.format(new Date(resetDate)) : this.dateFormatter.value.format(new Date(resetDate)))));
			}

			if (this.chatEntitlementService.entitlement === ChatEntitlement.Free && (Number(chatQuota?.percentRemaining) <= 25 || Number(completionsQuota?.percentRemaining) <= 25)) {
				const upgradeProButton = disposables.add(new Button(this.element, { ...defaultButtonStyles, hoverDelegate: nativeHoverDelegate, secondary: canUseChat(this.chatEntitlementService) /* use secondary color when chat can still be used */ }));
				upgradeProButton.label = localize('upgradeToCopilotPro', "Upgrade to GitHub Copilot Pro");
				disposables.add(upgradeProButton.onDidClick(() => this.runCommandAndClose('workbench.action.chat.upgradePlan')));
			}

			(async () => {
				await this.chatEntitlementService.update(token);
				if (token.isCancellationRequested) {
					return;
				}

				const { chat: chatQuota, completions: completionsQuota, premiumChat: premiumChatQuota } = this.chatEntitlementService.quotas;
				if (completionsQuota) {
					completionsQuotaIndicator?.(completionsQuota);
				}
				if (chatQuota) {
					chatQuotaIndicator?.(chatQuota);
				}
				if (premiumChatQuota) {
					premiumChatQuotaIndicator?.(premiumChatQuota);
				}
			})();
		}

		// Anonymous Indicator
		else if (this.chatEntitlementService.anonymous && this.chatEntitlementService.sentiment.installed) {
			addSeparator(localize('anonymousTitle', "Copilot Usage"));

			this.createQuotaIndicator(this.element, disposables, localize('quotaLimited', "Limited"), localize('completionsLabel', "Inline Suggestions"), false);
			this.createQuotaIndicator(this.element, disposables, localize('quotaLimited', "Limited"), localize('chatsLabel', "Chat messages"), false);
		}

		// Chat sessions
		{
			let chatSessionsElement: HTMLElement | undefined;

			const updateStatus = () => {
				const inProgress = this.chatSessionsService.getInProgress();
				if (inProgress.some(item => item.count > 0)) {

					addSeparator(localize('chatAgentSessionsTitle', "Agent Sessions"), toAction({
						id: 'workbench.view.chat.status.sessions',
						label: localize('viewChatSessionsLabel', "View Agent Sessions"),
						tooltip: localize('viewChatSessionsTooltip', "View Agent Sessions"),
						class: ThemeIcon.asClassName(Codicon.eye),
						run: () => {
							// TODO@bpasero remove this check once settled
							if (this.configurationService.getValue('chat.agentSessionsViewLocation') === 'single-view') {
								this.runCommandAndClose('workbench.view.agentSessions');
							} else {
								this.runCommandAndClose(AGENT_SESSIONS_VIEWLET_ID);
							}
						}
					}));

					for (const { displayName, count } of inProgress) {
						if (count > 0) {
							const text = localize('inProgressChatSession', "$(loading~spin) {0} in progress", displayName);
							chatSessionsElement = this.element.appendChild($('div.description'));
							const parts = renderLabelWithIcons(text);
							chatSessionsElement.append(...parts);
						}
					}
				} else {
					chatSessionsElement?.remove();
				}
			};

			updateStatus();
			disposables.add(this.chatSessionsService.onDidChangeInProgress(updateStatus));
		}

		// Contributions
		{
			for (const item of this.chatStatusItemService.getEntries()) {
				addSeparator();

				const itemDisposables = disposables.add(new MutableDisposable());

				let rendered = this.renderContributedChatStatusItem(item);
				itemDisposables.value = rendered.disposables;
				this.element.appendChild(rendered.element);

				disposables.add(this.chatStatusItemService.onDidChange(e => {
					if (e.entry.id === item.id) {
						const previousElement = rendered.element;

						rendered = this.renderContributedChatStatusItem(e.entry);
						itemDisposables.value = rendered.disposables;

						previousElement.replaceWith(rendered.element);
					}
				}));
			}
		}

		// --- Start Positron ---
		// Completion Providers
		{
			const entry = {
				id: 'positron-assistant.completionProviders',
				label: localize('completionProvidersLabel', "Completion Providers"),
				description: '',
				detail: '',
			};

			// Next Edit Suggestions not currently supported in Positron.
			// When enabled, remove the defaultChat.nextEditSuggestionsSetting check and use the setting directly.
			const nesEnabled = defaultChat.nextEditSuggestionsSetting
				? this.configurationService.getValue<boolean>(defaultChat.nextEditSuggestionsSetting) ?? false
				: false;

			const providers = this.languageFeaturesService.inlineCompletionsProvider.allNoModel();
			const details = new Array<HTMLDivElement>();
			providers.forEach(provider => {
				const name = provider.displayName;
				const shouldExclude = provider.groupId === 'nes' && !nesEnabled;
				if (name && !shouldExclude) {
					const span = document.createElement('div');
					span.innerText = name;
					details.push(span);
				}
			});

			/*
			 * Remove upstream code completion provider entry
			 *
			const chatSentiment = this.chatEntitlementService.sentiment;
			addSeparator(localize('codeCompletions', "Code Completions"), chatSentiment.installed && !chatSentiment.disabled && !chatSentiment.untrusted ? toAction({
				id: 'workbench.action.openChatSettings',
				label: localize('settingsLabel', "Settings"),
				tooltip: localize('settingsTooltip', "Open Settings"),
				class: ThemeIcon.asClassName(Codicon.settingsGear),
				run: () => this.runCommandAndClose(() => this.commandService.executeCommand('workbench.action.openSettings', { query: `@id:${defaultChat.completionsEnablementSetting} @id:${defaultChat.nextEditSuggestionsSetting}` })),
			}) : undefined);
			*/

			if (details.length === 0) {
				entry.description = localize('noCompletionProviders', "No completion providers available");
			}

			const itemDisposables = disposables.add(new MutableDisposable());
			const rendered = this.renderContributedChatStatusItem(entry);

			itemDisposables.value = rendered.disposables;
			this.element.appendChild(rendered.element);
			for (const detail of details) {
				rendered.element.appendChild(detail);
			}
		}

		// Provider token usage
		{
			const tokenEntry = {
				id: 'positron-assistant.providerTokenUsage',
				label: localize('providerTokenUsageLabel', "Provider Token Usage"),
				description: '',
				detail: '',
			};

			const providers = this.languageModelsService.getLanguageModelProviders();
			const details = new Array<HTMLSpanElement>();
			providers.forEach(provider => {
				const inputCount = this.contextKeyService.getContextKeyValue(`positron-assistant.${provider.id}.tokenCount.input`);
				const outputCount = this.contextKeyService.getContextKeyValue(`positron-assistant.${provider.id}.tokenCount.output`);
				const cachedCount = this.contextKeyService.getContextKeyValue(`positron-assistant.${provider.id}.tokenCount.cached`);
				if (typeof inputCount === 'number' && typeof outputCount === 'number') {
					const span = document.createElement('div');

					span.innerText = `${provider.displayName}: ↑${inputCount} ↓${outputCount} ↩${cachedCount}`;
					details.push(span);
				} else {
					// add an element to the container with the name and a message
					const span = document.createElement('div');
					span.innerText = `${provider.displayName}: ${localize('noTokenUsage', "No token usage available")}`;
					details.push(span);
				}
			});

			if (providers.length === 0) {
				tokenEntry.description = localize('noProviderTokenUsage', "No provider token usage available");
			}

			const itemDisposables = disposables.add(new MutableDisposable());
			const rendered = this.renderContributedChatStatusItem(tokenEntry);

			itemDisposables.value = rendered.disposables;
			this.element.appendChild(rendered.element);
			for (const detail of details) {
				rendered.element.appendChild(detail);
			}
		}

		// Settings
		{
			const chatSentiment = this.chatEntitlementService.sentiment;
			addSeparator(localize('inlineSuggestions', "Inline Suggestions"), chatSentiment.installed && !chatSentiment.disabled && !chatSentiment.untrusted ? toAction({
				id: 'workbench.action.openChatSettings',
				label: localize('settingsLabel', "Settings"),
				tooltip: localize('settingsTooltip', "Open Settings"),
				class: ThemeIcon.asClassName(Codicon.settingsGear),
				run: () => this.runCommandAndClose(() => this.commandService.executeCommand('workbench.action.openSettings', { query: `@id:${defaultChat.completionsEnablementSetting} @id:${defaultChat.nextEditSuggestionsSetting}` })),
			}) : undefined);

			this.createSettings(this.element, disposables);
		}

		// Completions Snooze
		if (canUseChat(this.chatEntitlementService)) {
			const snooze = append(this.element, $('div.snooze-completions'));
			this.createCompletionsSnooze(snooze, localize('settings.snooze', "Snooze"), disposables);
		}

		// New to Chat / Signed out
		// --- Start Positron ---
		// Disable this section since we don't to prompt users to sign in or set up Copilot.
		if (!this.entryDisposables)
		// --- End Positron ---
		{
			const newUser = isNewUser(this.chatEntitlementService);
			const anonymousUser = this.chatEntitlementService.anonymous;
			const disabled = this.chatEntitlementService.sentiment.disabled || this.chatEntitlementService.sentiment.untrusted;
			const signedOut = this.chatEntitlementService.entitlement === ChatEntitlement.Unknown;
			if (newUser || signedOut || disabled) {
				addSeparator();

				let descriptionText: string | MarkdownString;
				let descriptionClass = '.description';
				if (newUser && anonymousUser) {
					descriptionText = new MarkdownString(localize({ key: 'activeDescriptionAnonymous', comment: ['{Locked="]({2})"}', '{Locked="]({3})"}'] }, "By continuing with {0} Copilot, you agree to {1}'s [Terms]({2}) and [Privacy Statement]({3})", defaultChat.provider.default.name, defaultChat.provider.default.name, defaultChat.termsStatementUrl, defaultChat.privacyStatementUrl), { isTrusted: true });
					descriptionClass = `${descriptionClass}.terms`;
				} else if (newUser) {
					descriptionText = localize('activateDescription', "Set up Copilot to use AI features.");
				} else if (anonymousUser) {
					descriptionText = localize('enableMoreDescription', "Sign in to enable more Copilot AI features.");
				} else if (disabled) {
					descriptionText = localize('enableDescription', "Enable Copilot to use AI features.");
				} else {
					descriptionText = localize('signInDescription', "Sign in to use Copilot AI features.");
				}

				let buttonLabel: string;
				if (newUser) {
					buttonLabel = localize('enableAIFeatures', "Use AI Features");
				} else if (anonymousUser) {
					buttonLabel = localize('enableMoreAIFeatures', "Enable more AI Features");
				} else if (disabled) {
					buttonLabel = localize('enableCopilotButton', "Enable AI Features");
				} else {
					buttonLabel = localize('signInToUseAIFeatures', "Sign in to use AI Features");
				}

				let commandId: string;
				if (newUser && anonymousUser) {
					commandId = 'workbench.action.chat.triggerSetupAnonymousWithoutDialog';
				} else {
					commandId = 'workbench.action.chat.triggerSetup';
				}

				if (typeof descriptionText === 'string') {
					this.element.appendChild($(`div${descriptionClass}`, undefined, descriptionText));
				} else {
					this.element.appendChild($(`div${descriptionClass}`, undefined, disposables.add(this.markdownRendererService.render(descriptionText)).element));
				}

				const button = disposables.add(new Button(this.element, { ...defaultButtonStyles, hoverDelegate: nativeHoverDelegate }));
				button.label = buttonLabel;
				disposables.add(button.onDidClick(() => this.runCommandAndClose(commandId)));
			}
		}

		return this.element;
	}

	private renderHeader(container: HTMLElement, disposables: DisposableStore, label: string, action?: IAction): void {
		const header = container.appendChild($('div.header', undefined, label ?? ''));

		if (action) {
			const toolbar = disposables.add(new ActionBar(header, { hoverDelegate: nativeHoverDelegate }));
			toolbar.push([action], { icon: true, label: false });
		}
	}

	private renderContributedChatStatusItem(item: ChatStatusEntry): { element: HTMLElement; disposables: DisposableStore } {
		const disposables = new DisposableStore();

		const itemElement = $('div.contribution');

		const headerLabel = typeof item.label === 'string' ? item.label : item.label.label;
		const headerLink = typeof item.label === 'string' ? undefined : item.label.link;
		this.renderHeader(itemElement, disposables, headerLabel, headerLink ? toAction({
			id: 'workbench.action.openChatStatusItemLink',
			label: localize('learnMore', "Learn More"),
			tooltip: localize('learnMore', "Learn More"),
			class: ThemeIcon.asClassName(Codicon.linkExternal),
			run: () => this.runCommandAndClose(() => this.openerService.open(URI.parse(headerLink))),
		}) : undefined);

		const itemBody = itemElement.appendChild($('div.body'));

		const description = itemBody.appendChild($('span.description'));
		this.renderTextPlus(description, item.description, disposables);

		if (item.detail) {
			const detail = itemBody.appendChild($('div.detail-item'));
			this.renderTextPlus(detail, item.detail, disposables);
		}

		return { element: itemElement, disposables };
	}

	private renderTextPlus(target: HTMLElement, text: string, store: DisposableStore): void {
		for (const node of parseLinkedText(text).nodes) {
			if (typeof node === 'string') {
				const parts = renderLabelWithIcons(node);
				target.append(...parts);
			} else {
				store.add(new Link(target, node, undefined, this.hoverService, this.openerService));
			}
		}
	}

	private runCommandAndClose(commandOrFn: string | Function, ...args: unknown[]): void {
		if (typeof commandOrFn === 'function') {
			commandOrFn(...args);
		} else {
			this.telemetryService.publicLog2<WorkbenchActionExecutedEvent, WorkbenchActionExecutedClassification>('workbenchActionExecuted', { id: commandOrFn, from: 'chat-status' });
			this.commandService.executeCommand(commandOrFn, ...args);
		}

		this.hoverService.hideHover(true);
	}

	private createQuotaIndicator(container: HTMLElement, disposables: DisposableStore, quota: IQuotaSnapshot | string, label: string, supportsOverage: boolean): (quota: IQuotaSnapshot | string) => void {
		const quotaValue = $('span.quota-value');
		const quotaBit = $('div.quota-bit');
		const overageLabel = $('span.overage-label');

		const quotaIndicator = container.appendChild($('div.quota-indicator', undefined,
			$('div.quota-label', undefined,
				$('span', undefined, label),
				quotaValue
			),
			$('div.quota-bar', undefined,
				quotaBit
			),
			$('div.description', undefined,
				overageLabel
			)
		));

		if (supportsOverage && (this.chatEntitlementService.entitlement === ChatEntitlement.Pro || this.chatEntitlementService.entitlement === ChatEntitlement.ProPlus)) {
			const manageOverageButton = disposables.add(new Button(quotaIndicator, { ...defaultButtonStyles, secondary: true, hoverDelegate: nativeHoverDelegate }));
			manageOverageButton.label = localize('enableAdditionalUsage', "Manage paid premium requests");
			disposables.add(manageOverageButton.onDidClick(() => this.runCommandAndClose(() => this.openerService.open(URI.parse(defaultChat.manageOverageUrl)))));
		}

		const update = (quota: IQuotaSnapshot | string) => {
			quotaIndicator.classList.remove('error');
			quotaIndicator.classList.remove('warning');

			let usedPercentage: number;
			if (typeof quota === 'string' || quota.unlimited) {
				usedPercentage = 0;
			} else {
				usedPercentage = Math.max(0, 100 - quota.percentRemaining);
			}

			if (typeof quota === 'string') {
				quotaValue.textContent = quota;
			} else if (quota.unlimited) {
				quotaValue.textContent = localize('quotaUnlimited', "Included");
			} else if (quota.overageCount) {
				quotaValue.textContent = localize('quotaDisplayWithOverage', "+{0} requests", this.quotaOverageFormatter.value.format(quota.overageCount));
			} else {
				quotaValue.textContent = localize('quotaDisplay', "{0}%", this.quotaPercentageFormatter.value.format(usedPercentage));
			}

			quotaBit.style.width = `${usedPercentage}%`;

			if (usedPercentage >= 90) {
				quotaIndicator.classList.add('error');
			} else if (usedPercentage >= 75) {
				quotaIndicator.classList.add('warning');
			}

			if (supportsOverage) {
				if (typeof quota !== 'string' && quota?.overageEnabled) {
					overageLabel.textContent = localize('additionalUsageEnabled', "Additional paid premium requests enabled.");
				} else {
					overageLabel.textContent = localize('additionalUsageDisabled', "Additional paid premium requests disabled.");
				}
			} else {
				overageLabel.textContent = '';
			}
		};

		update(quota);

		return update;
	}

	private createSettings(container: HTMLElement, disposables: DisposableStore): HTMLElement {
		const modeId = this.editorService.activeTextEditorLanguageId;
		const settings = container.appendChild($('div.settings'));

		// --- Inline Suggestions
		{
			const globalSetting = append(settings, $('div.setting'));
			this.createInlineSuggestionsSetting(globalSetting, localize('settings.codeCompletions.allFiles', "All files"), '*', disposables);

			if (modeId) {
				const languageSetting = append(settings, $('div.setting'));
				this.createInlineSuggestionsSetting(languageSetting, localize('settings.codeCompletions.language', "{0}", this.languageService.getLanguageName(modeId) ?? modeId), modeId, disposables);
			}
		}

		// --- Start Positron ---
		// Disable this setting since we don't currently support it in Positron Assistant
		/*
		// --- Next edit suggestions
		{
			const setting = append(settings, $('div.setting'));
			this.createNextEditSuggestionsSetting(setting, localize('settings.nextEditSuggestions', "Next edit suggestions"), this.getCompletionsSettingAccessor(modeId), disposables);
		}
		*/
		// --- End Positron ---

		return settings;
	}

	private createSetting(container: HTMLElement, settingIdsToReEvaluate: string[], label: string, accessor: ISettingsAccessor, disposables: DisposableStore): Checkbox {
		const checkbox = disposables.add(new Checkbox(label, Boolean(accessor.readSetting()), { ...defaultCheckboxStyles }));
		container.appendChild(checkbox.domNode);

		const settingLabel = append(container, $('span.setting-label', undefined, label));
		disposables.add(Gesture.addTarget(settingLabel));
		[EventType.CLICK, TouchEventType.Tap].forEach(eventType => {
			disposables.add(addDisposableListener(settingLabel, eventType, e => {
				if (checkbox?.enabled) {
					EventHelper.stop(e, true);

					checkbox.checked = !checkbox.checked;
					accessor.writeSetting(checkbox.checked);
					checkbox.focus();
				}
			}));
		});

		disposables.add(checkbox.onChange(() => {
			accessor.writeSetting(checkbox.checked);
		}));

		disposables.add(this.configurationService.onDidChangeConfiguration(e => {
			if (settingIdsToReEvaluate.some(id => e.affectsConfiguration(id))) {
				checkbox.checked = Boolean(accessor.readSetting());
			}
		}));

		if (!canUseChat(this.chatEntitlementService)) {
			container.classList.add('disabled');
			checkbox.disable();
			checkbox.checked = false;
		}

		return checkbox;
	}

	private createInlineSuggestionsSetting(container: HTMLElement, label: string, modeId: string | undefined, disposables: DisposableStore): void {
		this.createSetting(container, [defaultChat.completionsEnablementSetting], label, this.getCompletionsSettingAccessor(modeId), disposables);
	}

	private getCompletionsSettingAccessor(modeId = '*'): ISettingsAccessor {
		const settingId = defaultChat.completionsEnablementSetting;

		return {
			readSetting: () => isCompletionsEnabled(this.configurationService, modeId),
			writeSetting: (value: boolean) => {
				this.telemetryService.publicLog2<ChatSettingChangedEvent, ChatSettingChangedClassification>('chatStatus.settingChanged', {
					settingIdentifier: settingId,
					settingMode: modeId,
					settingEnablement: value ? 'enabled' : 'disabled'
				});

				let result = this.configurationService.getValue<Record<string, boolean>>(settingId);
				if (!isObject(result)) {
					result = Object.create(null);
				}

				return this.configurationService.updateValue(settingId, { ...result, [modeId]: value });
			}
		};
	}

	// --- Start Positron ---
	// Make this method public to prevent it from being marked unused.
	//
	// We don't support Next Edit Suggestions in Assistant yet.
	// --- End Positron ---
	public createNextEditSuggestionsSetting(container: HTMLElement, label: string, completionsSettingAccessor: ISettingsAccessor, disposables: DisposableStore): void {
		const nesSettingId = defaultChat.nextEditSuggestionsSetting;
		const completionsSettingId = defaultChat.completionsEnablementSetting;
		const resource = EditorResourceAccessor.getOriginalUri(this.editorService.activeEditor, { supportSideBySide: SideBySideEditor.PRIMARY });

		const checkbox = this.createSetting(container, [nesSettingId, completionsSettingId], label, {
			readSetting: () => completionsSettingAccessor.readSetting() && this.textResourceConfigurationService.getValue<boolean>(resource, nesSettingId),
			writeSetting: (value: boolean) => {
				this.telemetryService.publicLog2<ChatSettingChangedEvent, ChatSettingChangedClassification>('chatStatus.settingChanged', {
					settingIdentifier: nesSettingId,
					settingEnablement: value ? 'enabled' : 'disabled'
				});

				return this.textResourceConfigurationService.updateValue(resource, nesSettingId, value);
			}
		}, disposables);

		// enablement of NES depends on completions setting
		// so we have to update our checkbox state accordingly

		if (!completionsSettingAccessor.readSetting()) {
			container.classList.add('disabled');
			checkbox.disable();
		}

		disposables.add(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(completionsSettingId)) {
				if (completionsSettingAccessor.readSetting() && canUseChat(this.chatEntitlementService)) {
					checkbox.enable();
					container.classList.remove('disabled');
				} else {
					checkbox.disable();
					container.classList.add('disabled');
				}
			}
		}));
	}

	private createCompletionsSnooze(container: HTMLElement, label: string, disposables: DisposableStore): void {
		const isEnabled = () => {
			const completionsEnabled = isCompletionsEnabled(this.configurationService);
			const completionsEnabledActiveLanguage = isCompletionsEnabled(this.configurationService, this.editorService.activeTextEditorLanguageId);
			return completionsEnabled || completionsEnabledActiveLanguage;
		};

		const button = disposables.add(new Button(container, { disabled: !isEnabled(), ...defaultButtonStyles, hoverDelegate: nativeHoverDelegate, secondary: true }));

		const timerDisplay = container.appendChild($('span.snooze-label'));

		const actionBar = container.appendChild($('div.snooze-action-bar'));
		const toolbar = disposables.add(new ActionBar(actionBar, { hoverDelegate: nativeHoverDelegate }));
		const cancelAction = toAction({
			id: 'workbench.action.cancelSnoozeStatusBarLink',
			label: localize('cancelSnooze', "Cancel Snooze"),
			run: () => this.inlineCompletionsService.cancelSnooze(),
			class: ThemeIcon.asClassName(Codicon.stopCircle)
		});

		const update = (isEnabled: boolean) => {
			container.classList.toggle('disabled', !isEnabled);
			toolbar.clear();

			const timeLeftMs = this.inlineCompletionsService.snoozeTimeLeft;
			if (!isEnabled || timeLeftMs <= 0) {
				timerDisplay.textContent = localize('completions.snooze5minutesTitle', "Hide suggestions for 5 min");
				timerDisplay.title = '';
				button.label = label;
				button.setTitle(localize('completions.snooze5minutes', "Hide inline suggestions for 5 min"));
				return true;
			}

			const timeLeftSeconds = Math.ceil(timeLeftMs / 1000);
			const minutes = Math.floor(timeLeftSeconds / 60);
			const seconds = timeLeftSeconds % 60;

			timerDisplay.textContent = `${minutes}:${seconds < 10 ? '0' : ''}${seconds} ${localize('completions.remainingTime', "remaining")}`;
			timerDisplay.title = localize('completions.snoozeTimeDescription', "Inline suggestions are hidden for the remaining duration");
			button.label = localize('completions.plus5min', "+5 min");
			button.setTitle(localize('completions.snoozeAdditional5minutes', "Snooze additional 5 min"));
			toolbar.push([cancelAction], { icon: true, label: false });

			return false;
		};

		// Update every second if there's time remaining
		const timerDisposables = disposables.add(new DisposableStore());
		function updateIntervalTimer() {
			timerDisposables.clear();
			const enabled = isEnabled();

			if (update(enabled)) {
				return;
			}

			timerDisposables.add(disposableWindowInterval(
				getWindow(container),
				() => update(enabled),
				1_000,
			));
		}
		updateIntervalTimer();

		disposables.add(button.onDidClick(() => {
			this.inlineCompletionsService.snooze();
			update(isEnabled());
		}));

		disposables.add(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(defaultChat.completionsEnablementSetting)) {
				button.enabled = isEnabled();
			}
			updateIntervalTimer();
		}));

		disposables.add(this.inlineCompletionsService.onDidChangeIsSnoozing(e => {
			updateIntervalTimer();
		}));
	}
}
