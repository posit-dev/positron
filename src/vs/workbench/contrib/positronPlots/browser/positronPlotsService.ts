/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { IPlotClientMessageInput, IPlotClientMessageOutput, PlotClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimePlotClient';
import { ILanguageRuntimeService, IRuntimeClientInstance, RuntimeClientType } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
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

			// Get the list of existing plot clients; these are expected in the
			// case of reconnecting to a running language runtime, and represent
			// the user's active set of plot objects.
			runtime.listClients().then(clients => {
				clients.forEach((client) => {
					if (client.getClientType() === RuntimeClientType.Plot) {
						this.registerPlotClient(client);
					}
				});
			});

			// Listen for new plots being emitted, and register each one with
			// the plots service.
			this._register(runtime.onDidCreateClientInstance((client) => {
				if (client.getClientType() === RuntimeClientType.Plot) {
					this.registerPlotClient(client);
				}
			}));
		}));
	}

	/**
	 * Creates a new plot client instance wrapper and registers it with the
	 * service.
	 *
	 * @param client The raw client instance.
	 */
	private registerPlotClient(client: IRuntimeClientInstance<IPlotClientMessageInput, IPlotClientMessageOutput>) {
		// Wrap the client instance in a PlotClientInstance object
		const plotClient = new PlotClientInstance(client);

		// Add to our list of plots and fire the event notifying subscribers
		this._plots.push(plotClient);
		this._onDidEmitPlot.fire(plotClient);

		// Remove the plot from our list when it is closed
		plotClient.onDidClose(() => {
			const index = this._plots.indexOf(plotClient);
			if (index >= 0) {
				this._plots.splice(index, 1);
			}
		});

		// Dispose the plot client when this service is disposed (we own this
		// object)
		this._register(plotClient);
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
