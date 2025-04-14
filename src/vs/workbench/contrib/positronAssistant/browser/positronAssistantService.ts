/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { PlotClientInstance } from '../../../services/languageRuntime/common/languageRuntimePlotClient.js';
import { IPositronConsoleService } from '../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { IPositronPlotsService } from '../../../services/positronPlots/common/positronPlots.js';
import { IPositronVariablesService } from '../../../services/positronVariables/common/interfaces/positronVariablesService.js';
import { PositronVariablesInstance } from '../../../services/positronVariables/common/positronVariablesInstance.js';
import { ITerminalService } from '../../terminal/browser/terminal.js';
import { IChatRequestData, IPositronAssistantService, IPositronChatContext, IPositronLanguageModelConfig, IPositronLanguageModelSource } from '../common/interfaces/positronAssistantService.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { ILayoutService } from '../../../../platform/layout/browser/layoutService.js';
import { showLanguageModelModalDialog } from './languageModelModalDialog.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { Emitter } from '../../../../base/common/event.js';

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
		@IPositronConsoleService private readonly _consoleService: IPositronConsoleService,
		@IPositronVariablesService private readonly _variableService: IPositronVariablesService,
		@IPositronPlotsService private readonly _plotService: IPositronPlotsService,
		@ITerminalService private readonly _terminalService: ITerminalService,
		@IKeybindingService private readonly _keybindingService: IKeybindingService,
		@ILayoutService private readonly _layoutService: ILayoutService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
	) {
		super();
	}

	initialize(): void { }

	//#endregion
	//#region Context and Tools

	getPositronChatContext(request: IChatRequestData): IPositronChatContext {
		const variablesInstance = this._variableService.activePositronVariablesInstance as PositronVariablesInstance | undefined;

		const runtimeMetadata =
			this._consoleService.activePositronConsoleInstance?.runtimeMetadata;
		const context: IPositronChatContext = {
			console: {
				language: runtimeMetadata?.languageName ?? '',
				version: runtimeMetadata?.languageVersion ?? '',
			},
			plots: {
				hasPlots: this.getCurrentPlotUri() !== undefined,
			},
			variables: variablesInstance?.variableItems.map((item) => {
				return {
					name: item.displayName,
					value: item.displayValue,
					type: item.displayType,
				};
			}) ?? [],
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

	//#endregion
	//#region Language Model UI

	showLanguageModelModalDialog(
		sources: IPositronLanguageModelSource[],
		onAction: (config: IPositronLanguageModelConfig, action: string) => Promise<void>,
		onCancel: () => void,
		onClose: () => void,
	): void {
		showLanguageModelModalDialog(this._keybindingService, this._layoutService, this._configurationService, this, sources, onAction, onCancel, onClose);
	}

	getSupportedProviders(): string[] {
		const providers = ['anthropic'];
		const useTestModels = this._configurationService.getValue<boolean>('positron.assistant.testModels');

		if (useTestModels) {
			providers.push('bedrock', 'error', 'echo', 'google', 'copilot');
		}
		return providers;
	}

	//#endregion
}

// Register the Positron assistant service.
registerSingleton(
	IPositronAssistantService,
	PositronAssistantService,
	InstantiationType.Delayed
);
