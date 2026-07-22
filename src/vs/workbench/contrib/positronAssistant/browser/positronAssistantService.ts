/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { PlotClientInstance } from '../../../services/languageRuntime/common/languageRuntimePlotClient.js';
import { IPositronPlotsService } from '../../../services/positronPlots/common/positronPlots.js';
import { ITerminalService } from '../../terminal/browser/terminal.js';
import { IChatRequestData, IPositronAssistantService, IPositronAssistantConfigurationService, IPositronChatContext, IPositronLanguageModelConfig, IPositronLanguageModelSource, IShowLanguageModelConfigOptions } from '../common/interfaces/positronAssistantService.js';
import { showLanguageModelModalDialog } from './languageModelModalDialog.js';
import { NEW_PROVIDER_MODAL_KEY, showConfigureLLMProvidersModal } from './configureLLMProvidersModal.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { Emitter } from '../../../../base/common/event.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { URI } from '../../../../base/common/uri.js';
import { IChatService } from '../../chat/common/chatService/chatService.js';
import { IChatWidgetService } from '../../chat/browser/chat.js';
import { isFileExcludedFromAI } from '../../chat/browser/tools/utils.js';
import { isCompletionsEnabled } from '../../../../editor/common/services/completionsEnablement.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { localize } from '../../../../nls.js';
import { IAiProviderService } from '../../../services/positronAiProvider/common/aiProviderService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { catalogIdForSettingName } from '../common/providerCatalogIds.js';

/**
 * PositronAssistantConfigurationService class.
 * Broken out from PositronAssistantService to avoid a circular dependency
 * between PositronAssistantService and ChatAgentService (through IChatService).
 */
export class PositronAssistantConfigurationService extends Disposable implements IPositronAssistantConfigurationService {
	declare readonly _serviceBrand: undefined;
	private _copilotEnabled = false;
	private _copilotEnabledEmitter = this._register(new Emitter<boolean>());
	private _enabledProvidersEmitter = this._register(new Emitter<void>());
	private _onChangeProviderConfigEmitter = this._register(new Emitter<IPositronLanguageModelSource>());

	// Tracks provider registrations. This is populated during extension
	// activation, independent of sign-in state.
	private _providerRegistrations = new Map<string, IPositronLanguageModelSource>();

	// Providers already notified about an 'error' status. Prevents repeat
	// notifications until the provider returns to 'ok'/null or is
	// unregistered.
	private _statusErrorNotified = new Set<string>();

	readonly onChangeCopilotEnabled = this._copilotEnabledEmitter.event;
	readonly onChangeEnabledProviders = this._enabledProvidersEmitter.event;
	readonly onChangeProviderConfig = this._onChangeProviderConfigEmitter.event;

	constructor(
		@INotificationService private readonly _notificationService: INotificationService,
		@ICommandService private readonly _commandService: ICommandService,
		@IAiProviderService private readonly _aiProviderService: IAiProviderService,
	) {
		super();

		// Provider enablement now comes from the catalog; only enabledChanged
		// events affect which registered providers are considered enabled.
		this._register(this._aiProviderService.onDidChangeProviders(e => {
			if (e.enabledChanged) {
				this._enabledProvidersEmitter.fire();
			}
		}));
	}

	registerProvider(source: IPositronLanguageModelSource): void {
		this._providerRegistrations.set(source.provider.id, source);
	}

	unregisterProvider(id: string): void {
		const source = this._providerRegistrations.get(id);
		this._providerRegistrations.delete(id);
		this._statusErrorNotified.delete(id);
		if (source) {
			this._onChangeProviderConfigEmitter.fire(source);
		}
	}

	updateProvider(id: string, update: Partial<IPositronLanguageModelSource>): void {
		const source = this._providerRegistrations.get(id);
		if (!source) {
			console.warn(`Cannot update unknown provider: ${id}`);
			return;
		}

		if (update.signedIn !== undefined) {
			source.signedIn = update.signedIn;
			// A fresh sign-in invalidates prior health observations.
			if (update.signedIn && update.status === undefined) {
				source.status = 'ok';
				source.statusMessage = undefined;
			}
		}
		if (update.statusMessage !== undefined) {
			source.statusMessage = update.statusMessage;
		}
		if (update.status !== undefined) {
			// An explicit null is stored; only undefined means "leave untouched".
			source.status = update.status;
			if (update.status !== 'error') {
				source.statusMessage = undefined;
			}
		}
		if (update.authMethods !== undefined) {
			source.authMethods = update.authMethods;
		}
		if (update.defaults !== undefined) {
			for (const [key, value] of Object.entries(update.defaults)) {
				if (value !== undefined) {
					(source.defaults as Record<string, unknown>)[key] = value;
				}
			}
		}

		this._onChangeProviderConfigEmitter.fire(source);

		if (id === 'copilot-auth' && update.signedIn !== undefined) {
			this.copilotEnabled = !!update.signedIn;
		}

		this.notifyProviderStatusError(source);
	}

	/**
	 * Surface a provider's 'error' status as a notification, once per
	 * provider until the status returns to 'ok'/null.
	 */
	private notifyProviderStatusError(source: IPositronLanguageModelSource): void {
		const id = source.provider.id;

		if (source.status !== 'error') {
			this._statusErrorNotified.delete(id);
			return;
		}
		if (this._statusErrorNotified.has(id) || !this.isProviderEnabled(id)) {
			return;
		}
		this._statusErrorNotified.add(id);

		const message = source.statusMessage
			? localize('positron.providerStatusError', "{0}: {1}", source.provider.displayName, source.statusMessage)
			: localize('positron.providerStatusErrorGeneric', "{0} reported a problem with its configuration or credentials.", source.provider.displayName);
		this._notificationService.prompt(
			Severity.Info,
			message,
			[{
				label: localize('positron.configureProvider', "Configure"),
				run: () => this._commandService.executeCommand('authentication.configureProviders', { preselectedProviderId: id }),
			}]
		);
	}

	getRegisteredSources(): IPositronLanguageModelSource[] {
		const enabledProviders = this.getEnabledProviders();
		const sources: IPositronLanguageModelSource[] = [];

		for (const [id, source] of this._providerRegistrations.entries()) {
			if (!enabledProviders.includes(id)) {
				continue;
			}
			sources.push(source);
		}

		return sources;
	}

	get copilotEnabled(): boolean {
		return this._copilotEnabled;
	}

	set copilotEnabled(value: boolean) {
		this._copilotEnabled = value;
		this._copilotEnabledEmitter.fire(this._copilotEnabled);
	}

	private isSourceEnabled(source: IPositronLanguageModelSource): boolean {
		const catalogId = catalogIdForSettingName(source.provider.settingName);
		// Providers without a catalog entry (dev-only echo/error) follow the
		// catalog baseline: enabled by default.
		return catalogId === undefined || this._aiProviderService.isEnabled(catalogId);
	}

	getEnabledProviders(): string[] {
		const enabledProviders: string[] = [];
		for (const [providerId, source] of this._providerRegistrations.entries()) {
			if (this.isSourceEnabled(source)) {
				enabledProviders.push(providerId);
			}
		}
		return enabledProviders;
	}

	isProviderEnabled(providerId: string): boolean {
		for (const source of this._providerRegistrations.values()) {
			const catalogId = catalogIdForSettingName(source.provider.settingName);
			// Callers pass either the registered provider id (openai-api) or the
			// vendor/catalog id (openai, copilot); both resolve to the same source.
			if (source.provider.id === providerId || catalogId === providerId) {
				return this.isSourceEnabled(source);
			}
		}
		return false;
	}
}


/**
 * PositronAssistantService class.
 */
export class PositronAssistantService extends Disposable implements IPositronAssistantService {
	declare readonly _serviceBrand: undefined;

	//#region Constructor

	constructor(
		@IChatService private readonly _chatService: IChatService,
		@IChatWidgetService private readonly _chatWidgetService: IChatWidgetService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ILanguageService private readonly _languageService: ILanguageService,
		@IPositronPlotsService private readonly _plotService: IPositronPlotsService,
		@IProductService protected readonly _productService: IProductService,
		@ITerminalService private readonly _terminalService: ITerminalService,
		@IPositronAssistantConfigurationService private readonly _assistantConfigurationService: PositronAssistantConfigurationService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IAiProviderService private readonly _aiProviderService: IAiProviderService,
		@IEditorService private readonly _editorService: IEditorService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();
	}

	initialize(): void { }

	//#endregion
	//#region Context and Tools

	getPositronChatContext(request: IChatRequestData): IPositronChatContext {
		const now = new Date();
		const options: Intl.DateTimeFormatOptions = {
			weekday: 'long',
			year: 'numeric',
			month: 'long',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
			timeZoneName: 'short',
		};

		// Use the product service to get the Positron version if known;
		// otherwise, use a default format based on the current date (E.g.,
		// 2026.01.0-dev)
		const positronVersion = this._productService ?
			`${this._productService.positronVersion}-${this._productService.positronBuildNumber}`
			: `${now.getFullYear()}.${(now.getMonth() + 1).toString().padStart(2, '0')}.0-dev`;

		const context: IPositronChatContext = {
			positronVersion,
			currentDate: now.toLocaleDateString(undefined, options),
			plots: {
				hasPlots: this.getCurrentPlotUri() !== undefined,
			},
		};

		if (request.location === 'terminal') {
			context.shell = this._terminalService.activeInstance?.shellType;
		}

		return context;
	}

	getCurrentPlotUri(): string | undefined {
		const plot = this._plotService.positronPlotInstances.find(plot => plot.id === this._plotService.selectedPlotId);
		const isPlotVisible = !!(plot instanceof PlotClientInstance && plot.lastRender);
		return isPlotVisible ? plot.lastRender.uri : undefined;
	}

	areCompletionsEnabled(uri: URI): boolean {
		// First, check the completions enablement setting for the file's
		// language. This reads the product-configured setting
		// (`github.copilot.enable`), the single source of truth shared with
		// Copilot, the Assistant's toggle command, and the chat status UI.
		const languageId = this._languageService.guessLanguageIdByFilepathOrFirstLine(uri) ?? undefined;
		if (!isCompletionsEnabled(this._configurationService, languageId)) {
			return false; // Completions are disabled for this language
		}

		// Then, check the exclusion patterns
		if (isFileExcludedFromAI(this._configurationService, uri.path)) {
			return false; // File matches an exclusion pattern, so it is excluded from completions
		}

		return true; // No patterns matched, so completions are enabled
	}

	//#endregion
	//#region Language Model UI

	showLanguageModelModalDialog(
		onAction: (source: IPositronLanguageModelSource, config: IPositronLanguageModelConfig, action: string) => Promise<void>,
		onClose: () => void,
		options?: IShowLanguageModelConfigOptions,
	): void {
		// Fire-and-forget, guaranteed to terminate: whenInitialized never
		// rejects, so either the dialog/prompt shows or onClose runs.
		this._aiProviderService.whenInitialized.then(() => {
			const sources = this._assistantConfigurationService.getRegisteredSources();
			if (sources.length === 0) {
				this._notificationService.prompt(
					Severity.Info,
					localize('positron.noProvidersEnabled', "No language model providers are enabled. Enable at least one provider in providers.json."),
					[{
						label: localize('positron.openProvidersJson', "Open providers.json"),
						run: async () => {
							const resource = await this._aiProviderService.getConfigFileUri();
							await this._editorService.openEditor({ resource });
						},
					}]
				);
				onClose();
				return;
			}
			// Feature switch: the new "Configure LLM Providers" modal
			const useNewModal = this._configurationService.getValue<boolean>(NEW_PROVIDER_MODAL_KEY) === true;
			const showModal = useNewModal ? showConfigureLLMProvidersModal : showLanguageModelModalDialog;
			showModal(
				sources,
				onAction,
				onClose,
				options
			);
		}).catch(error => {
			this._logService.error('[positron assistant] failed to show provider dialog', error);
			onClose();
		});
	}

	getChatExport() {
		const chatWidget = this._chatWidgetService.lastFocusedWidget;
		if (!chatWidget || !chatWidget.viewModel) {
			return undefined;
		}

		const model = this._chatService.getSession(chatWidget.viewModel.sessionResource);
		if (!model) {
			return undefined;
		}

		return model.toExport();
	}

	//#endregion
}

// Register the Positron assistant configuration service.
registerSingleton(
	IPositronAssistantConfigurationService,
	PositronAssistantConfigurationService,
	InstantiationType.Delayed
);

// Register the Positron assistant service.
registerSingleton(
	IPositronAssistantService,
	PositronAssistantService,
	InstantiationType.Delayed
);
