/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import * as nls from '../../../../nls.js';
import { localize, localize2 } from '../../../../nls.js';
import { ILocalizedString } from '../../../../platform/action/common/action.js';
import { Action2, IAction2Options, MenuId } from '../../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { IsDevelopmentContext } from '../../../../platform/contextkey/common/contextkeys.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IQuickInputService, IQuickPick, IQuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';
import { PLOT_IS_ACTIVE_EDITOR, POSITRON_EDITOR_PLOTS } from '../../positronPlotsEditor/browser/positronPlotsEditor.contribution.js';
import { PositronPlotsEditorInput } from '../../positronPlotsEditor/browser/positronPlotsEditorInput.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IPositronPlotClient, IPositronPlotsService } from '../../../services/positronPlots/common/positronPlots.js';
import { PlotClientInstance } from '../../../services/languageRuntime/common/languageRuntimePlotClient.js';
import { ThemeIcon } from '../../../../base/common/themables.js';

export enum PlotActionTarget {
	VIEW = 'view',
	ACTIVE_EDITOR = 'activeEditor',
}
export const POSITRON_PLOTS_ACTION_CATEGORY = nls.localize('positronPlotsCategory', "Plots");
const category: ILocalizedString = { value: POSITRON_PLOTS_ACTION_CATEGORY, original: 'Plots' };

/**
 * Abstract class for plot actions that can run for the Plots View or an editor tab. The action
 * will show a quick pick if there are multiple options. The first option is always the view if it
 * has a plot.
 */
abstract class AbstractPlotsAction extends Action2 {
	quickPickService?: IQuickInputService;

	constructor(descriptor: IAction2Options) {
		super(descriptor);
	}

	/**
	 * Executes the action on the quick pick item.
	 *
	 * @param quickPick quick pick item to execute on
	 * @param plotsService the plots service
	 * @param editorService the editor service
	 * @param notificationService the notification service
	 */
	abstract executeQuickPick(quickPick: IQuickPickItem, plotsService: IPositronPlotsService,
		editorService: IEditorService, notificationService: INotificationService): void;

	/**
	 * Executes the action on the target.
	 *
	 * @param target target to execute on
	 * @param plotsService the plots service
	 * @param editorService the editor service
	 * @param notificationService the notification service
	 */
	abstract executeTargetAction(target: PlotActionTarget, plotsService: IPositronPlotsService,
		editorService: IEditorService, notificationService: INotificationService): void;

	async run(accessor: ServicesAccessor, target?: PlotActionTarget): Promise<void> {
		const plotsService = accessor.get(IPositronPlotsService);
		const notificationService = accessor.get(INotificationService);
		const editorService = accessor.get(IEditorService);
		const configurationService = accessor.get(IConfigurationService);
		this.quickPickService = accessor.get(IQuickInputService);

		const editorPlotsEnabled = Boolean(configurationService.getValue(POSITRON_EDITOR_PLOTS));

		const quickPickItems = this.getItems(plotsService, editorService);
		// no need to show the quick pick if there is only one option or editor plots are disabled
		if (quickPickItems.length === 1 || !editorPlotsEnabled) {
			this.executeQuickPick(quickPickItems[0], plotsService, editorService, notificationService);
			return;
		}

		if (quickPickItems.length === 0) {
			notificationService.error(localize('positronPlots.noPlotsFound', 'No plots available.'));
			return;
		}

		if (target) {
			this.executeTargetAction(target, plotsService, editorService, notificationService);
		} else {
			const quickPicker = this.quickPickService.createQuickPick();

			quickPicker.items = quickPickItems;
			quickPicker.ignoreFocusOut = true;
			quickPicker.hideInput = true;
			quickPicker.title = localize('positronPlots.action.selectPlot', 'Select a plot');

			quickPicker.onDidAccept((_event) => {
				const selectedItem =
					quickPicker.selectedItems[0];
				if (selectedItem) {
					this.executeQuickPick(selectedItem, plotsService, editorService, notificationService);
				} else {
					notificationService.info(localize('positronPlots.noPlotSelected', 'No plot selected.'));
				}
				quickPicker.hide();
			});

			quickPicker.onDidHide(() => {
				quickPicker.dispose();
			});

			quickPicker.show();
		}
	}

	/**
	 * A filter to determine if the plot should be included in the action.
	 *
	 * @returns true if the plot should be included
	 */
	protected plotActionFilter(_plotClient: IPositronPlotClient): boolean {
		return true;
	}

	/**
	 * Gets the active editor plot id.
	 *
	 * @param editorService the editor service
	 * @returns a plot id or undefined
	 */
	protected getActiveEditorPlotId(editorService: IEditorService): string | undefined {
		if (editorService.activeEditorPane?.getId() === PositronPlotsEditorInput.EditorID) {
			return editorService.activeEditorPane?.input?.resource?.path.toString();
		}
		return undefined;
	}

	/**
	 * Creates quick pick plot items for the action. The first item is always the view.
	 *
	 * @param plotsService the plots service
	 * @param editorService the editor service
	 * @returns array of quick pick items
	 */
	protected getItems(plotsService: IPositronPlotsService, editorService: IEditorService): IQuickPickItem[] {
		const items: IQuickPickItem[] = [];

		if (plotsService.selectedPlotId) {
			const plotClient = plotsService.positronPlotInstances.find(p => p.id === plotsService.selectedPlotId);
			if (plotClient && this.plotActionFilter(plotClient)) {
				items.push({
					id: PlotActionTarget.VIEW,
					label: localize('positronPlots.copyPlotsView', 'From Plots View'),
					ariaLabel: localize('positronPlots.copyPlotsView', 'From Plots View'),
				});
			}
		}

		editorService.editors.forEach(input => {
			if (input.editorId === PositronPlotsEditorInput.EditorID) {
				const name = input.getName();
				const plotId = input.resource?.path.toString();
				if (plotId) {
					const plotClient = plotsService.getEditorInstance(plotId);
					if (plotClient && this.plotActionFilter(plotClient)) {
						items.push({
							id: plotId,
							label: localize('positronPlots.copyEditor', 'Editor: {0}', name),
							ariaLabel: localize('positronPlots.copyEditor', 'Editor: {0}', name),
						});
					}
				}
			}
		});

		return items;
	}
}

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

export class PlotsSaveAction extends AbstractPlotsAction {
	static ID = 'workbench.action.positronPlots.save';

	constructor() {
		super({
			id: PlotsSaveAction.ID,
			title: localize2('positronPlots.savePlots', 'Save Plot'),
			category,
			f1: true,
		});
	}

	override executeTargetAction(target: PlotActionTarget, plotsService: IPositronPlotsService,
		editorService: IEditorService, notificationService: INotificationService) {
		if (target === PlotActionTarget.VIEW) {
			plotsService.saveViewPlot();
		} else if (target === PlotActionTarget.ACTIVE_EDITOR) {
			if (editorService.activeEditorPane?.getId() === PositronPlotsEditorInput.EditorID) {
				const plotId = editorService.activeEditorPane?.input?.resource?.path.toString();
				try {
					if (!plotId) {
						notificationService.error(localize('positronPlotsServicePlotNotFound', 'Plot {0} was not found', plotId));
						return;
					}
					plotsService.saveEditorPlot(plotId);
				} catch (error) {
					notificationService.error(localize('positronPlotsServiceSavePlotError', 'Failed to save plot: {0}', error.message));
				}
			}
		} else {
			notificationService.info(localize('positronPlots.noPlotSelected', 'No plot selected.'));
		}
	}

	override executeQuickPick(quickPick: IQuickPickItem, plotsService: IPositronPlotsService,
		editorService: IEditorService, notificationService: INotificationService) {
		if (quickPick.id === PlotActionTarget.VIEW) {
			plotsService.saveViewPlot();
		} else {
			const plotId = quickPick.id;
			if (!plotId) {
				notificationService.error(localize('positronPlotsServicePlotNotFound', 'Plot {0} was not found', plotId));
				return;
			}
			plotsService.saveEditorPlot(plotId);
		}
	}
}

export class PlotsCopyAction extends AbstractPlotsAction {
	static ID = 'workbench.action.positronPlots.copy';

	constructor() {
		super({
			id: PlotsCopyAction.ID,
			title: localize2('positronPlots.copyPlot', 'Copy Plot'),
			category,
			f1: true,
		});
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

	private copyEditorPlotToClipboard(plotsService: IPositronPlotsService, notificationService: INotificationService, plotId: string) {
		plotsService.copyEditorPlotToClipboard(plotId)
			.then(() => {
				notificationService.info(localize('positronPlots.plotCopied', 'Plot copied to clipboard.'));
			})
			.catch((error) => {
				notificationService.error(localize('positronPlotsServiceCopyToClipboardError', 'Failed to copy plot to clipboard: {0}', error.message));
			});
	}

	override executeQuickPick(selectedItem: IQuickPickItem, plotsService: IPositronPlotsService,
		editorService: IEditorService, notificationService: INotificationService) {
		if (selectedItem?.id) {
			if (selectedItem.id === PlotActionTarget.VIEW) {
				this.copyViewPlotToClipboard(plotsService, notificationService);
			} else {
				this.copyEditorPlotToClipboard(plotsService, notificationService, selectedItem.id);
			}
		}
	}

	override executeTargetAction(target: PlotActionTarget, plotsService: IPositronPlotsService,
		editorService: IEditorService, notificationService: INotificationService) {
		if (target === PlotActionTarget.VIEW) {
			this.copyViewPlotToClipboard(plotsService, notificationService);
		} else if (target === PlotActionTarget.ACTIVE_EDITOR) {
			const plotId = this.getActiveEditorPlotId(editorService);
			if (plotId) {
				this.copyEditorPlotToClipboard(plotsService, notificationService, plotId);
			} else {
				notificationService.info(localize('positronPlots.noPlotSelected', 'No plot selected.'));
			}
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
	async run(accessor: ServicesAccessor, groupType?: number) {
		const plotsService = accessor.get(IPositronPlotsService);
		if (plotsService.selectedPlotId) {
			plotsService.openEditor(plotsService.selectedPlotId, groupType);
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
			precondition: PLOT_IS_ACTIVE_EDITOR,
			menu: [
				{
					id: MenuId.EditorTitle,
					when: PLOT_IS_ACTIVE_EDITOR,
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
		commandService.executeCommand(PlotsCopyAction.ID, PlotActionTarget.ACTIVE_EDITOR);
	}
}

/**
 * Action to save the plot from the active editor.
 * It is not invokable from the command palette.
 */
export class PlotsActiveEditorSaveAction extends Action2 {
	static ID = 'workbench.action.positronPlots.saveActiveEditor';

	constructor() {
		super({
			id: PlotsActiveEditorSaveAction.ID,
			title: localize2('positronPlots.editorSavePlot', 'Save Plot From Active Editor'),
			category,
			f1: false, // do not show in the command palette
			icon: Codicon.positronSave,
			precondition: PLOT_IS_ACTIVE_EDITOR,
			menu: [
				{
					id: MenuId.EditorTitle,
					when: PLOT_IS_ACTIVE_EDITOR,
					group: 'navigation',
					order: 1,
				}
			]
		});
	}

	/**
	 * Runs the action and saves the plot from the active editor.
	 *
	 * @param accessor The service accessor.
	 */
	async run(accessor: ServicesAccessor) {
		const commandService = accessor.get(ICommandService);
		commandService.executeCommand(PlotsSaveAction.ID, PlotActionTarget.ACTIVE_EDITOR);
	}
}

/** Action to change the plot's sizing policy */
export class PlotsSizingPolicyAction extends AbstractPlotsAction {
	static ID = 'workbench.action.positronPlots.sizingPolicy';
	sizingPicker?: IQuickPick<IQuickPickItem, any>;

	constructor() {
		super({
			id: PlotsSizingPolicyAction.ID,
			title: localize2('positronPlots.sizingPolicy', 'Change Plot Sizing Policy'),
			category,
			f1: true,
		});
	}

	override run(accessor: ServicesAccessor, target?: PlotActionTarget): Promise<void> {
		return super.run(accessor, target);
	}

	override executeQuickPick(quickPick: IQuickPickItem, plotsService: IPositronPlotsService, editorService: IEditorService, notificationService: INotificationService): void {
		const plotId = quickPick.id;

		if (!plotId) {
			notificationService.info(localize('positronPlots.noPlotSelected', 'No plot selected.'));
			return;
		}

		const isView = plotId === PlotActionTarget.VIEW;

		if (isView) {
			this.executeTargetAction(PlotActionTarget.VIEW, plotsService, editorService, notificationService);
		} else {
			const plotClient = plotsService.getEditorInstance(plotId);
			if (plotClient instanceof PlotClientInstance) {
				if (!this.quickPickService) {
					return;
				}

				this.getSizingPolicy(plotsService, editorService, () => {
					if (!this.sizingPicker) {
						return;
					}

					const selectedItem = this.sizingPicker.selectedItems[0];
					if (selectedItem?.id) {
						plotsService.setEditorSizingPolicy(plotId, selectedItem.id);
					}
				});
			}
		}
	}

	override executeTargetAction(target: PlotActionTarget, plotsService: IPositronPlotsService, editorService: IEditorService, notificationService: INotificationService): void {
		this.getSizingPolicy(plotsService, editorService, () => {
			if (!this.sizingPicker) {
				return;
			}

			const selectedItem = this.sizingPicker.selectedItems[0];
			if (selectedItem?.id) {
				if (target === PlotActionTarget.VIEW) {
					plotsService.selectSizingPolicy(selectedItem.id);
				} else {
					const plotId = this.getActiveEditorPlotId(editorService);
					if (plotId) {
						plotsService.setEditorSizingPolicy(plotId, selectedItem.id);
					}
				}
			}
		});
	}

	private getSizingPolicy(plotsService: IPositronPlotsService, editorService: IEditorService, onAccept: () => void): void {
		if (!this.quickPickService) {
			return;
		}

		const sizingItems = this.createSizingItems(plotsService);
		this.sizingPicker = this.quickPickService.createQuickPick();

		this.sizingPicker.items = sizingItems;
		this.sizingPicker.title = localize('positronPlots.action.selectSizingPolicy', 'Select a sizing policy');

		this.sizingPicker.show();

		this.sizingPicker.onDidAccept(() => {
			onAccept();
			this.sizingPicker?.hide();
		});
	}

	private createSizingItems(plotsService: IPositronPlotsService, plotId?: string): IQuickPickItem[] {
		const items: IQuickPickItem[] = [];
		const plotClient = plotId ? plotsService.getEditorInstance(plotId)
			: plotsService.positronPlotInstances.find(p => p.id === plotsService.selectedPlotId) as PlotClientInstance;

		if (!plotClient || !(plotClient instanceof PlotClientInstance)) {
			throw new Error('Plot not found');
		}

		plotsService.sizingPolicies.forEach(policy => {
			items.push({
				id: policy.id,
				label: policy.getName(plotClient),
				ariaLabel: policy.getName(plotClient),
				iconClass: plotClient.sizingPolicy.id === policy.id ? ThemeIcon.asClassName(Codicon.positronCheckMark)
					: ThemeIcon.asClassName(Codicon.blank),
			});
		});

		return items;
	}

	protected override plotActionFilter(plotClient: IPositronPlotClient): boolean {
		return plotClient instanceof PlotClientInstance;
	}
}
