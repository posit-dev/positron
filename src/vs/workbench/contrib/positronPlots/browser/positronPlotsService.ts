/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { IPlotClientMessageInput, IPlotClientMessageOutput, PlotClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimePlotClient';
import { ILanguageRuntimeMessageOutput, ILanguageRuntimeService, IRuntimeClientInstance, RuntimeClientType } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IPositronPlotsService, PositronPlotClient } from 'vs/workbench/services/positronPlots/common/positronPlots';
import { Emitter, Event } from 'vs/base/common/event';
import { StaticPlotClient } from 'vs/workbench/services/positronPlots/common/staticPlotClient';

/**
 * PositronPlotsService class.
 */
export class PositronPlotsService extends Disposable implements IPositronPlotsService {
	/** Needed for service branding in dependency injector. */
	declare readonly _serviceBrand: undefined;

	/** The list of Positron plots. */
	private readonly _plots: PositronPlotClient[] = [];

	/** The emitter for the onDidEmitPlot event */
	private readonly _onDidEmitPlot = new Emitter<PositronPlotClient>();

	/** The emitter for the onDidSelectPlot event */
	private readonly _onDidSelectPlot = new Emitter<string>();

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

			// Listen for new dynamic plots being emitted, and register each one
			// with the plots service.
			this._register(runtime.onDidCreateClientInstance((event) => {
				if (event.client.getClientType() === RuntimeClientType.Plot) {
					this.registerPlotClient(event.client);
				}
			}));

			// Listen for static plots being emitted, and register each one with
			// the plots service.
			this._register(runtime.onDidReceiveRuntimeMessageOutput((message) => {
				const imageKey = Object.keys(message.data).find(key => key.startsWith('image/'));
				if (imageKey) {
					this.registerStaticPlot(message);
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
		this._plots.unshift(plotClient);
		this._onDidEmitPlot.fire(plotClient);
		this._onDidSelectPlot.fire(plotClient.id);

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

	/**
	 * Creates a new static plot client instance and registers it with the
	 * service.
	 *
	 * @param message The message containing the static plot data.
	 */
	private registerStaticPlot(message: ILanguageRuntimeMessageOutput) {
		const client = new StaticPlotClient(message);
		this._plots.unshift(client);
		this._onDidEmitPlot.fire(client);
		this._onDidSelectPlot.fire(client.id);
		this._register(client);
	}

	onDidEmitPlot: Event<PositronPlotClient> = this._onDidEmitPlot.event;
	onDidSelectPlot: Event<string> = this._onDidSelectPlot.event;

	// Gets the individual plot instances.
	get positronPlotInstances(): PositronPlotClient[] {
		return this._plots;
	}

	/**
	 * Select a plot by ID
	 *
	 * @param index The ID of the plot to select.
	 */
	selectPlot(id: string): void {
		this._onDidSelectPlot.fire(id);
	}

	/**
	 * Placeholder for service initialization.
	 */
	initialize() {
	}
}
