/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { PlotClientInstance } from '../../../services/languageRuntime/common/languageRuntimePlotClient.js';
import { IPositronPlotsService } from '../../../services/positronPlots/common/positronPlots.js';
import { ITerminalService } from '../../terminal/browser/terminal.js';
import { IChatRequestData, IPositronAssistantService, IPositronAssistantConfigurationService, IPositronChatContext } from '../common/interfaces/positronAssistantService.js';
import { Emitter } from '../../../../base/common/event.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IAiProviderService } from '../../../services/positronAiProvider/common/aiProviderService.js';

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

	readonly onChangeCopilotEnabled = this._copilotEnabledEmitter.event;
	readonly onChangeEnabledProviders = this._enabledProvidersEmitter.event;

	constructor(
		@IAiProviderService private readonly _aiProviderService: IAiProviderService,
	) {
		super();

		// Enablement comes from the catalog, so only enabledChanged matters.
		this._register(this._aiProviderService.onDidChangeProviders(e => {
			if (e.enabledChanged) {
				this._enabledProvidersEmitter.fire();
			}
		}));
	}

	get copilotEnabled(): boolean {
		return this._copilotEnabled;
	}

	set copilotEnabled(value: boolean) {
		this._copilotEnabled = value;
		this._copilotEnabledEmitter.fire(this._copilotEnabled);
	}

	/**
	 * Whether a provider is enabled in the resolved catalog (providers.json).
	 *
	 * `providerId` is a catalog id. A provider the catalog has never heard of
	 * stays enabled, so a chat vendor that has no providers.json entry is not
	 * silently filtered out of the model picker.
	 */
	isProviderEnabled(providerId: string): boolean {
		return this._aiProviderService.getProvider(providerId) === undefined
			|| this._aiProviderService.isEnabled(providerId);
	}
}


/**
 * PositronAssistantService class.
 */
export class PositronAssistantService extends Disposable implements IPositronAssistantService {
	declare readonly _serviceBrand: undefined;

	//#region Constructor

	constructor(
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

	//#endregion
	//#region Language Model UI

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
