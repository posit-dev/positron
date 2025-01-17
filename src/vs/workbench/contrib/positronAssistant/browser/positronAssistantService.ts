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

/**
 * PositronAssistantService class.
 */
export class PositronAssistantService extends Disposable implements IPositronAssistantService {
	declare readonly _serviceBrand: undefined;

	//#region Constructor

	constructor(
		@IPositronConsoleService private readonly _consoleService: IPositronConsoleService,
		@IPositronVariablesService private readonly _variableService: IPositronVariablesService,
		@IPositronPlotsService private readonly _plotService: IPositronPlotsService,
		@ITerminalService private readonly _terminalService: ITerminalService,
		@IKeybindingService private readonly _keybindingService: IKeybindingService,
		@ILayoutService private readonly _layoutService: ILayoutService,
	) {
		super();
	}

	initialize(): void { }

	//#endregion
	//#region Context and Tools

	getPositronChatContext(request: IChatRequestData): IPositronChatContext {
		const variablesInstance = this._variableService.activePositronVariablesInstance as PositronVariablesInstance | undefined;

		const context: IPositronChatContext = {
			console: {
				language: this._consoleService.activePositronConsoleInstance?.session.runtimeMetadata.languageName ?? '',
				version: this._consoleService.activePositronConsoleInstance?.session.runtimeMetadata.languageVersion ?? '',
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

	//#endregion
	//#region Language Model UI

	showLanguageModelModalDialog(sources: IPositronLanguageModelSource[]): Promise<IPositronLanguageModelConfig | undefined> {
		return new Promise((resolve) => {
			showLanguageModelModalDialog(
				this._keybindingService,
				this._layoutService,
				sources,
				(config) => resolve(config),
				() => resolve(undefined),
			);
		});

	}

	//#endregion
}

// Register the Positron assistant service.
registerSingleton(
	IPositronAssistantService,
	PositronAssistantService,
	InstantiationType.Delayed
);
