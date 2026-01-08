/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { PlotClientInstance } from '../../../services/languageRuntime/common/languageRuntimePlotClient.js';
import { IPositronPlotsService } from '../../../services/positronPlots/common/positronPlots.js';
import { ITerminalService } from '../../terminal/browser/terminal.js';
import { IChatRequestData, IPositronAssistantService, IPositronAssistantConfigurationService, IPositronChatContext, IPositronLanguageModelConfig, IPositronLanguageModelSource } from '../common/interfaces/positronAssistantService.js';
import { showLanguageModelModalDialog } from './languageModelModalDialog.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { Emitter } from '../../../../base/common/event.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { URI } from '../../../../base/common/uri.js';
import { IChatService } from '../../chat/common/chatService.js';
import { IChatWidgetService } from '../../chat/browser/chat.js';
import { isFileExcludedFromAI } from '../../chat/browser/tools/utils.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { ILanguageModelsService } from '../../chat/common/languageModels.js';

/**
 * PositronAssistantConfigurationService class.
 * Broken out from PositronAssistantService to avoid a circular dependency
 * between PositronAssistantService and ChatAgentService (through IChatService).
 */
export class PositronAssistantConfigurationService extends Disposable implements IPositronAssistantConfigurationService {
	declare readonly _serviceBrand: undefined;
	private _copilotEnabled = false;
	private _copilotEnabledEmitter = this._register(new Emitter<boolean>());

	readonly onChangeCopilotEnabled = this._copilotEnabledEmitter.event;

	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ILanguageModelsService private readonly _languageModelsService: ILanguageModelsService,
	) {
		super();
	}

	get copilotEnabled(): boolean {
		return this._copilotEnabled;
	}

	set copilotEnabled(value: boolean) {
		this._copilotEnabled = value;
		this._copilotEnabledEmitter.fire(this._copilotEnabled);
	}

	getEnabledProviders(): string[] {
		// Read new providers setting (object with boolean values)
		const providersConfig = this._configurationService.getValue<Record<string, boolean>>('positron.assistant.providers') || {};
		const enabledFromProviders = Object.keys(providersConfig).filter(key => providersConfig[key]);

		// DEPRECATED: Read legacy enabledProviders setting (array of strings)
		// TODO: Remove this when positron.assistant.enabledProviders is fully deprecated
		const enabledFromLegacy = this._configurationService.getValue<string[]>('positron.assistant.enabledProviders') || [];

		// Build UI name to provider ID mapping from extension package.json contributions
		// This uses the languageModelChatProviders contribution point which extensions
		// declare in their package.json with both vendor (provider ID) and displayName (UI name).
		// This mapping is available immediately when extensions are loaded, unlike registered
		// language models which may not be available yet (e.g., if API keys aren't configured).
		const uiNameToId = new Map<string, string>();
		const vendors = this._languageModelsService.getVendors();
		for (const vendor of vendors) {
			// Filter out non-copilot vendors from the Copilot extension
			// The Copilot extension declares vendors like 'anthropic', 'openai', 'azure', etc.
			// for its BYOK (Bring Your Own Key) feature, but Positron Assistant provides
			// its own implementations of these providers with different vendor IDs
			// (e.g., 'anthropic-api' vs 'anthropic')
			const extensionId = this._languageModelsService.getExtensionIdentifierForProvider(vendor.vendor);
			if (extensionId?._lower === 'github.copilot-chat' && vendor.vendor !== 'copilot') {
				continue; // Skip non-copilot vendors from Copilot extension
			}

			// Special case: GitHub Copilot extension declares displayName as "Copilot" in package.json,
			// but Positron's settings use "GitHub Copilot" for clarity
			if (vendor.vendor === 'copilot') {
				uiNameToId.set('GitHub Copilot', 'copilot');
			} else {
				uiNameToId.set(vendor.displayName, vendor.vendor);
			}
		}

		// Map UI names to provider IDs (fallback to original if not found)
		const mapToId = (name: string) => uiNameToId.get(name) || name;

		// Merge and deduplicate
		return Array.from(new Set([
			...enabledFromProviders.map(mapToId),
			...enabledFromLegacy.map(mapToId)
		]));
	}
}


/**
 * PositronAssistantService class.
 */
export class PositronAssistantService extends Disposable implements IPositronAssistantService {
	declare readonly _serviceBrand: undefined;

	// Tracks the models that have been added and signed in
	private _languageModelRegistry = new Set<string>();

	// event emmitter for language model configuration
	private _onLanguageModelConfigEmitter = new Emitter<IPositronLanguageModelSource>();
	readonly onChangeLanguageModelConfig = this._onLanguageModelConfigEmitter.event;

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

	addLanguageModelConfig(source: IPositronLanguageModelSource): void {
		this._languageModelRegistry.add(source.provider.id);

		if (source.provider.id === 'copilot') {
			this._assistantConfigurationService.copilotEnabled = !!source.signedIn;
		}

		this._onLanguageModelConfigEmitter.fire(source);
	}

	removeLanguageModelConfig(source: IPositronLanguageModelSource): void {
		this._languageModelRegistry.delete(source.provider.id);

		if (source.provider.id === 'copilot') {
			this._assistantConfigurationService.copilotEnabled = false;
		}

		this._onLanguageModelConfigEmitter.fire(source);
	}

	areCompletionsEnabled(uri: URI): boolean {
		// First, check the language-specific enable setting
		const enableSettings = this._configurationService.getValue<Record<string, boolean>>('positron.assistant.inlineCompletions.enable');

		if (enableSettings && typeof enableSettings === 'object') {
			// Get the language ID from the URI
			const languageId = this._languageService.guessLanguageIdByFilepathOrFirstLine(uri);

			// Check if the specific language is disabled
			if (languageId && enableSettings.hasOwnProperty(languageId) && !enableSettings[languageId]) {
				return false; // Language is explicitly disabled
			}

			// Check if all languages are disabled via the "*" key
			if (enableSettings.hasOwnProperty('*') && !enableSettings['*']) {
				return false; // All languages are disabled
			}
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
		sources: IPositronLanguageModelSource[],
		onAction: (config: IPositronLanguageModelConfig, action: string) => Promise<void>,
		onClose: () => void,
	): void {
		showLanguageModelModalDialog(
			sources,
			onAction,
			onClose
		);
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
