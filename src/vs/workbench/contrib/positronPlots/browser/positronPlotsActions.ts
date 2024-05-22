/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { localize, localize2 } from 'vs/nls';
import { ILocalizedString } from 'vs/platform/action/common/action';
import { Action2 } from 'vs/platform/actions/common/actions';
import { IsDevelopmentContext } from 'vs/platform/contextkey/common/contextkeys';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IPositronPlotsService } from 'vs/workbench/services/positronPlots/common/positronPlots';

export const POSITRON_PLOTS_ACTION_CATEGORY = nls.localize('positronPlotsCategory', "Plots");
const category: ILocalizedString = { value: POSITRON_PLOTS_ACTION_CATEGORY, original: 'Plots' };

export class PlotsRefreshAction extends Action2 {

	static ID = 'workbench.action.positronPlots.refresh';

	constructor() {
		super({
			id: PlotsRefreshAction.ID,
			title: localize2('positronPlots.refreshPlots', 'Refresh Plots'),
			f1: true,
			category,
			precondition: IsDevelopmentContext, // hide this from release until implemented
		});
	}

	/**
	 * Runs the action and refreshes the plots.
	 *
	 * @param accessor The service accessor.
	 */
	async run(accessor: ServicesAccessor) {
		// TODO: Implement a plots service.
	}
}

export class PlotsSaveAction extends Action2 {
	static ID = 'workbench.action.positronPlots.save';

	constructor() {
		super({
			id: PlotsSaveAction.ID,
			title: localize2('positronPlots.savePlots', 'Save Plot'),
			category,
			f1: true,
		});
	}

	/**
	 * Runs the action and saves the plots.
	 *
	 * @param accessor The service accessor.
	 */
	async run(accessor: ServicesAccessor) {
		const plotsService = accessor.get(IPositronPlotsService);
		if (plotsService.selectedPlotId) {
			try {
				plotsService.savePlot();
			} catch (error) {
				accessor.get(INotificationService).error(localize('positronPlotsServiceSavePlotError', 'Failed to save plot: {0}', error.message));
			}
		} else {
			accessor.get(INotificationService).info(localize('positronPlots.noPlotSelected', 'No plot selected.'));
		}
	}
}

export class PlotsCopyAction extends Action2 {
	static ID = 'workbench.action.positronPlots.copy';

	constructor() {
		super({
			id: PlotsCopyAction.ID,
			title: localize2('positronPlots.copyPlot', 'Copy Plot'),
			category,
			f1: true,
		});
	}

	/**
	 * Runs the action and copies the plots.
	 *
	 * @param accessor The service accessor.
	 */
	async run(accessor: ServicesAccessor) {
		const plotsService = accessor.get(IPositronPlotsService);
		const notificationService = accessor.get(INotificationService);
		if (plotsService.selectedPlotId) {
			plotsService.copyPlotToClipboard()
				.then(() => {
					notificationService.info(localize('positronPlots.plotCopied', 'Plot copied to clipboard.'));
				}
				).catch((error) => {
					notificationService.error(localize('positronPlotsServiceCopyToClipboardError', 'Failed to copy plot to clipboard: {0}', error.message));
				});
		} else {
			notificationService.info(localize('positronPlots.noPlotSelected', 'No plot selected.'));
		}
	}
}

export class PlotsNextAction extends Action2 {
	static ID = 'workbench.action.positronPlots.next';

	constructor() {
		super({
			id: PlotsNextAction.ID,
			title: localize2('positronPlots.nextPlot', 'Select Next Plot'),
			category,
			f1: true,
		});
	}

	/**
	 * Runs the action and selects the next plot.
	 *
	 * @param accessor The service accessor.
	 */
	async run(accessor: ServicesAccessor) {
		const plotsService = accessor.get(IPositronPlotsService);
		plotsService.selectNextPlot();
	}
}

export class PlotsPreviousAction extends Action2 {
	static ID = 'workbench.action.positronPlots.previous';

	constructor() {
		super({
			id: PlotsPreviousAction.ID,
			title: localize2('positronPlots.previousPlot', 'Select Previous Plot'),
			category,
			f1: true,
		});
	}

	/**
	 * Runs the action and selects the previous plot.
	 *
	 * @param accessor The service accessor.
	 */
	async run(accessor: ServicesAccessor) {
		const plotsService = accessor.get(IPositronPlotsService);
		plotsService.selectPreviousPlot();
	}
}

export class PlotsClearAction extends Action2 {
	static ID = 'workbench.action.positronPlots.clear';

	constructor() {
		super({
			id: PlotsClearAction.ID,
			title: localize2('positronPlots.clearPlots', 'Clear Plots'),
			category,
			f1: true,
		});
	}

	/**
	 * Runs the action and clears the plots.
	 *
	 * @param accessor The service accessor.
	 */
	async run(accessor: ServicesAccessor) {
		const plotsService = accessor.get(IPositronPlotsService);
		if (plotsService.positronPlotInstances.length > 0) {
			plotsService.removeAllPlots();
		}
	}
}
