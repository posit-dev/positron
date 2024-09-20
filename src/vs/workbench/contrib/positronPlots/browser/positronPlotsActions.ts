/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from 'vs/base/common/codicons';
import * as nls from 'vs/nls';
import { localize, localize2 } from 'vs/nls';
import { ILocalizedString } from 'vs/platform/action/common/action';
import { Action2, MenuId } from 'vs/platform/actions/common/actions';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { IsDevelopmentContext } from 'vs/platform/contextkey/common/contextkeys';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IQuickInputService, IQuickPick, IQuickPickItem } from 'vs/platform/quickinput/common/quickInput';
import { PLOT_IS_ACTIVE_EDITOR, POSITRON_EDITOR_PLOTS } from 'vs/workbench/contrib/positronPlotsEditor/browser/positronPlotsEditor.contribution';
import { PositronPlotsEditorInput } from 'vs/workbench/contrib/positronPlotsEditor/browser/positronPlotsEditorInput';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IPositronPlotsService } from 'vs/workbench/services/positronPlots/common/positronPlots';

export enum CopyPlotTarget {
	VIEW = 'view',
	ACTIVE_EDITOR = 'activeEditor',
}

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

	private _currentQuickPick?: IQuickPick<IQuickPickItem>;

	constructor() {
		super({
			id: PlotsCopyAction.ID,
			title: localize2('positronPlots.copyPlot', 'Copy Plot'),
			category,
			f1: true,
		});
	}

	private getItems(editorService: IEditorService): IQuickPickItem[] {
		const items: IQuickPickItem[] = [
			{
				type: 'item',
				id: CopyPlotTarget.VIEW,
				label: localize('positronPlots.copyPlotsView', 'From Plots View'),
				ariaLabel: localize('positronPlots.copyPlotsView', 'From Plots View'),
			}
		];

		editorService.editors.forEach(input => {
			if (input.editorId === PositronPlotsEditorInput.EditorID) {
				const name = input.getName();
				const plotId = input.resource?.path.toString();
				if (plotId) {
					items.push({
						type: 'item',
						id: plotId,
						label: localize('positronPlots.copyEditor', 'Editor: {0}', name),
						ariaLabel: localize('positronPlots.copyEditor', 'Editor: {0}', name),
					});
				}
			}
		});

		return items;
	}

	private copyViewPlotToClipboard(plotsService: IPositronPlotsService, notificationService: INotificationService) {
		if (plotsService.selectedPlotId) {
			plotsService.copyViewPlotToClipboard()
				.then(() => {
					notificationService.info(localize('positronPlots.plotCopied', 'Plot copied to clipboard.'));
				})
				.catch((error) => {
					notificationService.error(localize('positronPlotsServiceCopyToClipboardError', 'Failed to copy plot to clipboard: {0}', error.message));
				});
		} else {
			notificationService.info(localize('positronPlots.noPlotSelected', 'No plot selected.'));
		}
	}

	private copyEditorPlotToClipboard(plotsService: IPositronPlotsService, notificationService: INotificationService, editorService: IEditorService, plotId: string) {
		plotsService.copyEditorPlotToClipboard(plotId)
			.then(() => {
				notificationService.info(localize('positronPlots.plotCopied', 'Plot copied to clipboard.'));
			})
			.catch((error) => {
				notificationService.error(localize('positronPlotsServiceCopyToClipboardError', 'Failed to copy plot to clipboard: {0}', error.message));
			});
	}

	/**
	 * Runs the action. Shows a quick pick if no target is provided. Otherwise, copies the
	 * target plot to the clipboard.
	 *
	 * @param accessor The service accessor.
	 */
	async run(accessor: ServicesAccessor, target?: CopyPlotTarget) {
		const plotsService = accessor.get(IPositronPlotsService);
		const notificationService = accessor.get(INotificationService);
		const editorService = accessor.get(IEditorService);
		const quickPick = accessor.get(IQuickInputService);
		const configurationService = accessor.get(IConfigurationService);

		const editorPlotsEnabled = Boolean(configurationService.getValue(POSITRON_EDITOR_PLOTS));
		if (!editorPlotsEnabled) {
			target = CopyPlotTarget.VIEW;
		}

		const quickPickItems = this.getItems(editorService);
		// no need to show the quick pick if the only option is the Plots View
		if (quickPickItems.length === 1) {
			target = CopyPlotTarget.VIEW;
		}

		if (target === CopyPlotTarget.VIEW) {
			this.copyViewPlotToClipboard(plotsService, notificationService);
		} else if (target === CopyPlotTarget.ACTIVE_EDITOR) {
			if (editorService.activeEditorPane?.getId() === PositronPlotsEditorInput.EditorID) {
				const plotId = editorService.activeEditorPane?.input?.resource?.path.toString();
				if (plotId) {
					this.copyEditorPlotToClipboard(plotsService, notificationService, editorService, plotId);
				}
			} else {
				notificationService.error(localize('positronPlots.editorCopyNotActive', 'Active editor is not a plot.'));
			}
		} else {
			this._currentQuickPick = quickPick.createQuickPick();

			this._currentQuickPick.items = quickPickItems;
			this._currentQuickPick.ignoreFocusOut = true;
			this._currentQuickPick.hideInput = true;
			this._currentQuickPick.title = localize('positronPlots.copyQuickPickTitle', 'Select the plot to copy to clipboard');

			this._currentQuickPick.onDidAccept((_event) => {
				const selectedItem = this._currentQuickPick?.selectedItems[0];
				if (selectedItem?.id) {
					if (selectedItem.id === CopyPlotTarget.VIEW) {
						this.copyViewPlotToClipboard(plotsService, notificationService);
					} else {
						this.copyEditorPlotToClipboard(plotsService, notificationService, editorService, selectedItem.id);
					}

				}

				this._currentQuickPick?.hide();
			});

			this._currentQuickPick.onDidHide(() => {
				this._currentQuickPick?.dispose();
			});

			this._currentQuickPick.onDispose(() => {
				this._currentQuickPick = undefined;
			});

			this._currentQuickPick.show();
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

/**
 * Action to pop the selected plot out into a new window.
 */
export class PlotsPopoutAction extends Action2 {
	static ID = 'workbench.action.positronPlots.popout';

	constructor() {
		super({
			id: PlotsPopoutAction.ID,
			title: localize2('positronPlots.popoutPlot', 'Open Plot in New Window'),
			category,
			f1: true,
		});
	}

	/**
	 * Runs the action and opens the selected plot in a new window.
	 *
	 * @param accessor The service accessor.
	 */
	async run(accessor: ServicesAccessor) {
		const plotsService = accessor.get(IPositronPlotsService);
		if (plotsService.selectedPlotId) {
			plotsService.openPlotInNewWindow();
		} else {
			accessor.get(INotificationService).info(localize('positronPlots.noPlotSelected', 'No plot selected.'));
		}
	}
}

export class PlotsEditorAction extends Action2 {
	static ID = 'workbench.action.positronPlots.openEditor';

	constructor() {
		super({
			id: PlotsEditorAction.ID,
			title: localize2('positronPlots.openEditor', 'Open Plot in Editor Tab'),
			category,
			f1: true,
			precondition: ContextKeyExpr.equals(`config.${POSITRON_EDITOR_PLOTS}`, true),
		});
	}

	/**
	 * Runs the action and opens the selected plot in the editor.
	 *
	 * @param accessor The service accessor.
	 */
	async run(accessor: ServicesAccessor) {
		const plotsService = accessor.get(IPositronPlotsService);
		if (plotsService.selectedPlotId) {
			plotsService.openEditor();
		} else {
			accessor.get(INotificationService).info(localize('positronPlots.noPlotSelected', 'No plot selected.'));
		}
	}
}

/**
 * Action to copy the plot from the active editor to the clipboard.
 * It is not invokable from the command palette.
 */
export class PlotsActiveEditorCopyAction extends Action2 {
	static ID = 'workbench.action.positronPlots.copyActiveEditor';

	constructor() {
		super({
			id: PlotsActiveEditorCopyAction.ID,
			title: localize2('positronPlots.editorCopyPlot', 'Copy Plot From Active Editor to Clipboard'),
			category,
			f1: false, // do not show in the command palette
			icon: Codicon.copy,
			precondition: ContextKeyExpr.and(ContextKeyExpr.equals(`config.${POSITRON_EDITOR_PLOTS}`, true), PLOT_IS_ACTIVE_EDITOR),
			menu: [
				{
					id: MenuId.EditorTitle,
					when: ContextKeyExpr.and(ContextKeyExpr.equals(`config.${POSITRON_EDITOR_PLOTS}`, true), PLOT_IS_ACTIVE_EDITOR),
					group: 'navigation',
					order: 2,
				}
			]
		});
	}

	/**
	 * Runs the action and copies the plot from the active editor to the clipboard.
	 *
	 * @param accessor The service accessor.
	 */
	async run(accessor: ServicesAccessor) {
		const commandService = accessor.get(ICommandService);
		commandService.executeCommand(PlotsCopyAction.ID, CopyPlotTarget.ACTIVE_EDITOR);
	}
}
