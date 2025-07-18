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
import { $, addDisposableListener, append, clearNode, EventHelper, EventType } from '../../../../base/browser/dom.js';
import { ChatEntitlement, ChatEntitlementService, ChatSentiment, IChatEntitlementService, IQuotaSnapshot } from '../common/chatEntitlementService.js';
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

// --- Start Positron ---
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { ILanguageModelsService } from '../common/languageModels.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IEditorGroupsService, IEditorPart } from '../../../services/editor/common/editorGroupsService.js';
import { ChatContextKeys } from '../common/chatContextKeys.js';
// --- End Positron ---

const gaugeBackground = registerColor('gauge.background', {
	dark: inputValidationInfoBorder,
	light: inputValidationInfoBorder,
	hcDark: contrastBorder,
	hcLight: contrastBorder
}, localize('gaugeBackground', "Gauge background color."));

registerColor('gauge.foreground', {
	dark: transparent(gaugeBackground, 0.3),
	light: transparent(gaugeBackground, 0.3),
	hcDark: Color.white,
	hcLight: Color.white
}, localize('gaugeForeground', "Gauge foreground color."));

registerColor('gauge.border', {
	dark: null,
	light: null,
	hcDark: contrastBorder,
	hcLight: contrastBorder
}, localize('gaugeBorder', "Gauge border color."));

const gaugeWarningBackground = registerColor('gauge.warningBackground', {
	dark: inputValidationWarningBorder,
	light: inputValidationWarningBorder,
	hcDark: contrastBorder,
	hcLight: contrastBorder
}, localize('gaugeWarningBackground', "Gauge warning background color."));

registerColor('gauge.warningForeground', {
	dark: transparent(gaugeWarningBackground, 0.3),
	light: transparent(gaugeWarningBackground, 0.3),
	hcDark: Color.white,
	hcLight: Color.white
}, localize('gaugeWarningForeground', "Gauge warning foreground color."));

const gaugeErrorBackground = registerColor('gauge.errorBackground', {
	dark: inputValidationErrorBorder,
	light: inputValidationErrorBorder,
	hcDark: contrastBorder,
	hcLight: contrastBorder
}, localize('gaugeErrorBackground', "Gauge error background color."));

registerColor('gauge.errorForeground', {
	dark: transparent(gaugeErrorBackground, 0.3),
	light: transparent(gaugeErrorBackground, 0.3),
	hcDark: Color.white,
	hcLight: Color.white
}, localize('gaugeErrorForeground', "Gauge error foreground color."));

//#endregion

const defaultChat = {
	extensionId: product.defaultChatAgent?.extensionId ?? '',
	completionsEnablementSetting: product.defaultChatAgent?.completionsEnablementSetting ?? '',
	nextEditSuggestionsSetting: product.defaultChatAgent?.nextEditSuggestionsSetting ?? '',
	manageSettingsUrl: product.defaultChatAgent?.manageSettingsUrl ?? '',
	manageOverageUrl: product.defaultChatAgent?.manageOverageUrl ?? '',
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
		@IChatEntitlementService private readonly chatEntitlementService: ChatEntitlementService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IStatusbarService private readonly statusbarService: IStatusbarService,
		@IEditorService private readonly editorService: IEditorService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		// --- Start Positron ---
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		// --- End Positron ---
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
		if (!this.entry) {
			this.entry = this.statusbarService.addEntry(this.getEntryProps(), 'chat.statusBarEntry', StatusbarAlignment.RIGHT, { location: { id: 'status.editor.mode', priority: 100.1 }, alignment: StatusbarAlignment.RIGHT });
		} else {
			this.entry.update(this.getEntryProps());
		}
		// --- End Positron ---
	}

	private registerListeners(): void {
		this._register(this.chatEntitlementService.onDidChangeQuotaExceeded(() => this.update()));
		this._register(this.chatEntitlementService.onDidChangeSentiment(() => this.update()));
		this._register(this.chatEntitlementService.onDidChangeEntitlement(() => this.update()));

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

		if (!isNewUser(this.chatEntitlementService)) {
			const chatQuotaExceeded = this.chatEntitlementService.quotas.chat?.percentRemaining === 0;
			const completionsQuotaExceeded = this.chatEntitlementService.quotas.completions?.percentRemaining === 0;

			// Signed out
			if (this.chatEntitlementService.entitlement === ChatEntitlement.Unknown) {
				const signedOutWarning = localize('notSignedIntoCopilot', "Signed out");

				text = `$(copilot-not-connected) ${signedOutWarning}`;
				ariaLabel = signedOutWarning;
				kind = 'prominent';
			}

			// Free Quota Exceeded
			else if (this.chatEntitlementService.entitlement === ChatEntitlement.Limited && (chatQuotaExceeded || completionsQuotaExceeded)) {
				let quotaWarning: string;
				if (chatQuotaExceeded && !completionsQuotaExceeded) {
					quotaWarning = localize('chatQuotaExceededStatus', "Chat quota reached");
				} else if (completionsQuotaExceeded && !chatQuotaExceeded) {
					quotaWarning = localize('completionsQuotaExceededStatus', "Completions quota reached");
				} else {
					quotaWarning = localize('chatAndCompletionsQuotaExceededStatus', "Quota reached");
				}

				text = `$(copilot-warning) ${quotaWarning}`;
				ariaLabel = quotaWarning;
				kind = 'prominent';
			}

			// Completions Disabled
			else if (this.editorService.activeTextEditorLanguageId && !isCompletionsEnabled(this.configurationService, this.editorService.activeTextEditorLanguageId)) {
				text = `$(copilot-unavailable)`;
				ariaLabel = localize('completionsDisabledStatus', "Code Completions Disabled");
			}
		}

		return {
			name: localize('chatStatus', "Copilot Status"),
			text,
			ariaLabel,
			command: ShowTooltipCommand,
			// --- Start Positron ---
			// Do not show status in all windows; allows us to create a new status item
			// for each window manually
			// showInAllWindows: true,
			// --- End Positron ---
			kind,
			tooltip: { element: token => this.dashboard.value.show(token) }
		};
	}

	override dispose(): void {
		super.dispose();

		this.entry?.dispose();
		this.entry = undefined;
	}
}

function isNewUser(chatEntitlementService: IChatEntitlementService): boolean {
	return chatEntitlementService.sentiment !== ChatSentiment.Installed ||	// copilot not installed
		chatEntitlementService.entitlement === ChatEntitlement.Available;	// not yet signed up to copilot
}

function canUseCopilot(chatEntitlementService: IChatEntitlementService): boolean {
	const newUser = isNewUser(chatEntitlementService);
	const signedOut = chatEntitlementService.entitlement === ChatEntitlement.Unknown;
	const limited = chatEntitlementService.entitlement === ChatEntitlement.Limited;
	const allFreeQuotaReached = limited && chatEntitlementService.quotas.chat?.percentRemaining === 0 && chatEntitlementService.quotas.completions?.percentRemaining === 0;

	return !newUser && !signedOut && !allFreeQuotaReached;
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

	private dateFormatter = new Lazy(() => safeIntl.DateTimeFormat(language, { year: 'numeric', month: 'long', day: 'numeric' }));
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
		const { chat: chatQuota, completions: completionsQuota, premiumChat: premiumChatQuota, resetDate } = this.chatEntitlementService.quotas;
		if (chatQuota || completionsQuota || premiumChatQuota) {

			addSeparator(localize('usageTitle', "Copilot Usage"), toAction({
				id: 'workbench.action.manageCopilot',
				label: localize('quotaLabel', "Manage Copilot"),
				tooltip: localize('quotaTooltip', "Manage Copilot"),
				class: ThemeIcon.asClassName(Codicon.settings),
				run: () => this.runCommandAndClose(() => this.openerService.open(URI.parse(defaultChat.manageSettingsUrl))),
			}));

			const completionsQuotaIndicator = completionsQuota ? this.createQuotaIndicator(this.element, disposables, completionsQuota, localize('completionsLabel', "Code completions"), false) : undefined;
			const chatQuotaIndicator = chatQuota ? this.createQuotaIndicator(this.element, disposables, chatQuota, localize('chatsLabel', "Chat messages"), false) : undefined;
			const premiumChatQuotaIndicator = premiumChatQuota ? this.createQuotaIndicator(this.element, disposables, premiumChatQuota, localize('premiumChatsLabel', "Premium requests"), true) : undefined;

			if (resetDate) {
				this.element.appendChild($('div.description', undefined, localize('limitQuota', "Allowance resets {0}.", this.dateFormatter.value.format(new Date(resetDate)))));
			}

			if (this.chatEntitlementService.entitlement === ChatEntitlement.Limited && (Number(chatQuota?.percentRemaining) <= 25 || Number(completionsQuota?.percentRemaining) <= 25)) {
				const upgradeProButton = disposables.add(new Button(this.element, { ...defaultButtonStyles, secondary: canUseCopilot(this.chatEntitlementService) /* use secondary color when copilot can still be used */ }));
				upgradeProButton.label = localize('upgradeToCopilotPro', "Upgrade to Copilot Pro");
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
			this.languageFeaturesService.inlineCompletionsProvider.allNoModel().forEach(provider => {
				const name = provider.displayName;
				if (name) {
					// add an element to the container with the name
					entry.description += `${name}\n`;
				}
			});

			if (entry.description.length === 0) {
				entry.description = localize('noCompletionProviders', "No completion providers available");
			}

			const itemDisposables = disposables.add(new MutableDisposable());
			const rendered = this.renderContributedChatStatusItem(entry);

			itemDisposables.value = rendered.disposables;
			this.element.appendChild(rendered.element);
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
				if (typeof inputCount === 'number' && typeof outputCount === 'number') {
					const span = document.createElement('div');

					span.innerText = `${provider.displayName}: ↑${inputCount} ↓${outputCount}`;
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

		/*
		// Settings
		// {
		// 	addSeparator(localize('settingsTitle', "Settings"));

		// 	this.createSettings(this.element, disposables);
		// }


		// Remove Copilot

		// New to Copilot / Signed out
		{
			const newUser = isNewUser(this.chatEntitlementService);
			const signedOut = this.chatEntitlementService.entitlement === ChatEntitlement.Unknown;
			if (newUser || signedOut) {
				addSeparator();

				this.element.appendChild($('div.description', undefined, newUser ? localize('activateDescription', "Set up Copilot to use AI features.") : localize('signInDescription', "Sign in to use Copilot AI features.")));
				const button = disposables.add(new Button(this.element, { ...defaultButtonStyles }));
				button.label = newUser ? localize('activateCopilotButton', "Set up Copilot") : localize('signInToUseCopilotButton', "Sign in to use Copilot");
				disposables.add(button.onDidClick(() => this.runCommandAndClose(newUser ? 'workbench.action.chat.triggerSetup' : () => this.chatEntitlementService.requests?.value.signIn())));
			}
		}
		*/
		// --- End Positron ---

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

	private runCommandAndClose(commandOrFn: string | Function): void {
		if (typeof commandOrFn === 'function') {
			commandOrFn();
		} else {
			this.telemetryService.publicLog2<WorkbenchActionExecutedEvent, WorkbenchActionExecutedClassification>('workbenchActionExecuted', { id: commandOrFn, from: 'chat-status' });
			this.commandService.executeCommand(commandOrFn);
		}

		this.hoverService.hideHover(true);
	}

	private createQuotaIndicator(container: HTMLElement, disposables: DisposableStore, quota: IQuotaSnapshot, label: string, supportsOverage: boolean): (quota: IQuotaSnapshot) => void {
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
			const manageOverageButton = disposables.add(new Button(quotaIndicator, { ...defaultButtonStyles, secondary: true }));
			manageOverageButton.label = localize('enableAdditionalUsage', "Manage paid premium requests");
			disposables.add(manageOverageButton.onDidClick(() => this.runCommandAndClose(() => this.openerService.open(URI.parse(defaultChat.manageOverageUrl)))));
		}

		const update = (quota: IQuotaSnapshot) => {
			quotaIndicator.classList.remove('error');
			quotaIndicator.classList.remove('warning');

			let usedPercentage: number;
			if (quota.unlimited) {
				usedPercentage = 0;
			} else {
				usedPercentage = Math.max(0, 100 - quota.percentRemaining);
			}
			// Use intl number format to format the presented numbers
			const quotaPercentageFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1, minimumFractionDigits: 0 });
			const overageFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 0 });

			if (quota.unlimited) {
				quotaValue.textContent = localize('quotaUnlimited', "Included");
			} else if (quota.overageCount) {
				quotaValue.textContent = localize('quotaDisplayWithOverage', "+{0} requests", overageFormatter.format(quota.overageCount));
			} else {
				quotaValue.textContent = localize('quotaDisplay', "{0}%", quotaPercentageFormatter.format(usedPercentage));
			}

			quotaBit.style.width = `${usedPercentage}%`;

			if (usedPercentage >= 90) {
				quotaIndicator.classList.add('error');
			} else if (usedPercentage >= 75) {
				quotaIndicator.classList.add('warning');
			}

			if (supportsOverage) {
				if (quota.overageEnabled) {
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

	// --- Start Positron ---
	// Removed Settings section since it doesn't change Positron Assistant
	// @ts-ignore
	private createSettings(container: HTMLElement, disposables: DisposableStore): HTMLElement {
		const modeId = this.editorService.activeTextEditorLanguageId;
		const settings = container.appendChild($('div.settings'));

		// --- Code Completions
		{
			const globalSetting = append(settings, $('div.setting'));
			this.createCodeCompletionsSetting(globalSetting, localize('settings.codeCompletions', "Code Completions (all files)"), '*', disposables);

			if (modeId) {
				const languageSetting = append(settings, $('div.setting'));
				this.createCodeCompletionsSetting(languageSetting, localize('settings.codeCompletionsLanguage', "Code Completions ({0})", this.languageService.getLanguageName(modeId) ?? modeId), modeId, disposables);
			}
		}

		// --- Next Edit Suggestions
		{
			const setting = append(settings, $('div.setting'));
			this.createNextEditSuggestionsSetting(setting, localize('settings.nextEditSuggestions', "Next Edit Suggestions"), this.getCompletionsSettingAccessor(modeId), disposables);
		}

		return settings;
	}
	// --- End Positron ---

	private createSetting(container: HTMLElement, settingIdsToReEvaluate: string[], label: string, accessor: ISettingsAccessor, disposables: DisposableStore): Checkbox {
		const checkbox = disposables.add(new Checkbox(label, Boolean(accessor.readSetting()), defaultCheckboxStyles));
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

		if (!canUseCopilot(this.chatEntitlementService)) {
			container.classList.add('disabled');
			checkbox.disable();
			checkbox.checked = false;
		}

		return checkbox;
	}

	private createCodeCompletionsSetting(container: HTMLElement, label: string, modeId: string | undefined, disposables: DisposableStore): void {
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

	private createNextEditSuggestionsSetting(container: HTMLElement, label: string, completionsSettingAccessor: ISettingsAccessor, disposables: DisposableStore): void {
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
				if (completionsSettingAccessor.readSetting() && canUseCopilot(this.chatEntitlementService)) {
					checkbox.enable();
					container.classList.remove('disabled');
				} else {
					checkbox.disable();
					container.classList.add('disabled');
				}
			}
		}));
	}
}
