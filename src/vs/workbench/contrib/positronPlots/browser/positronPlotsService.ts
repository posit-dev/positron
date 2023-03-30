/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { PlotClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimePlotClient';
import { ILanguageRuntimeService, RuntimeClientType } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IPositronPlotsService } from 'vs/workbench/services/positronPlots/common/positronPlots';
import { Emitter, Event } from 'vs/base/common/event';

/**
 * PositronPlotsService class.
 */
export class PositronPlotsService extends Disposable implements IPositronPlotsService {
	/** Needed for service branding in dependency injector. */
	declare readonly _serviceBrand: undefined;

	/** The list of Positron plots. */
	private readonly _plots: PlotClientInstance[] = [];

	/** The emitter for the onDidEmitPlot event */
	private readonly _onDidEmitPlot = new Emitter<PlotClientInstance>();

	/** Creates the Positron plots service instance */
	constructor(@ILanguageRuntimeService private _languageRuntimeService: ILanguageRuntimeService) {
		super();

		// Register for language runtime service startups
		this._register(this._languageRuntimeService.onDidStartRuntime((runtime) => {

			// TODO: Ask the language runtime service for a list of all the clients
			// that it has created. For each client, check to see if it is a plot and
			// if so, register it with the plot service.

			this._register(runtime.onDidCreateClientInstance((client) => {
				if (client.getClientType() === RuntimeClientType.Plot) {
					const plotClient = new PlotClientInstance(client);
					// Register the plot client instance with the plot service.
					this._plots.push(plotClient);

					// Notify subscribers that a new plot instance has been created.
					this._onDidEmitPlot.fire(plotClient);
				}
			}));
		}));
	}

	onDidEmitPlot: Event<PlotClientInstance> = this._onDidEmitPlot.event;

	// Gets the individual plot instances.
	get positronPlotInstances(): PlotClientInstance[] {
		return this._plots;
	}

	/**
	 * Placeholder for service initialization.
	 */
	initialize() {
	}
}
