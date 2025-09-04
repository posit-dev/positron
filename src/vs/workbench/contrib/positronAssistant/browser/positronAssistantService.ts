/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { PlotClientInstance } from '../../../services/languageRuntime/common/languageRuntimePlotClient.js';
import { IPositronPlotsService } from '../../../services/positronPlots/common/positronPlots.js';
import { ITerminalService } from '../../terminal/browser/terminal.js';
import { IChatRequestData, IPositronAssistantService, IPositronChatContext, IPositronLanguageModelConfig, IPositronLanguageModelSource } from '../common/interfaces/positronAssistantService.js';
import { showLanguageModelModalDialog } from './languageModelModalDialog.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { Emitter } from '../../../../base/common/event.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { URI } from '../../../../base/common/uri.js';
import * as glob from '../../../../base/common/glob.js';
import { IChatService } from '../../chat/common/chatService.js';
import { IChatWidgetService } from '../../chat/browser/chat.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';

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

		this._onLanguageModelConfigEmitter.fire(source);
	}

	removeLanguageModelConfig(source: IPositronLanguageModelSource): void {
		this._languageModelRegistry.delete(source.provider.id);

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
		const globPattern = this._configurationService.getValue<string[]>('positron.assistant.inlineCompletionExcludes');

		if (!globPattern || globPattern.length === 0) {
			return true; // No glob patterns configured, so completions are enabled
		}

		// Check all of the glob patterns and return false if any match
		for (const pattern of globPattern) {
			if (glob.match(pattern, uri.path)) {
				return false; // File matches an exclusion pattern, so it is excluded from completions
			}
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

	getSupportedProviders(): string[] {
		const providers = ['anthropic', 'copilot'];
		const useTestModels = this._configurationService.getValue<boolean>('positron.assistant.testModels');

		if (useTestModels) {
			providers.push('amazon-bedrock', 'error', 'echo', 'google');
		}
		return providers;
	}

	getChatExport() {
		const chatWidget = this._chatWidgetService.lastFocusedWidget;
		if (!chatWidget || !chatWidget.viewModel) {
			return undefined;
		}

		const model = this._chatService.getSession(chatWidget.viewModel.sessionId);
		if (!model) {
			return undefined;
		}

		return model.toExport();
	}

	//#endregion
}

// Register the Positron assistant service.
registerSingleton(
	IPositronAssistantService,
	PositronAssistantService,
	InstantiationType.Delayed
);
