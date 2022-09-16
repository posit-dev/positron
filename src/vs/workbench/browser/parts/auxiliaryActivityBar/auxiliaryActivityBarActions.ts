/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import { ServicesAccessor } from 'vs/editor/browser/editorExtensions';
import { localize } from 'vs/nls';
import { Action2, MenuId, registerAction2 } from 'vs/platform/actions/common/actions';
import { CATEGORIES } from 'vs/workbench/common/actions';
import { AuxiliaryActivityBarVisibleContext } from 'vs/workbench/common/contextkeys';
import { IAuxiliaryActivityBarService } from 'vs/workbench/services/auxiliaryActivityBar/browser/auxiliaryActivityBarService';
import { IWorkbenchLayoutService, Parts } from 'vs/workbench/services/layout/browser/layoutService';

export class ToggleAuxiliaryActivityBarVisibilityAction extends Action2 {
	static readonly ID = 'workbench.action.toggleAuxiliaryActivityBarVisibility';

	constructor() {
		super({
			id: ToggleAuxiliaryActivityBarVisibilityAction.ID,
			title: {
				value: localize('toggleAuxiliaryActivityBarVisibility', "Toggle Secondary Activity Bar Visibility"),
				mnemonicTitle: localize({ key: 'miAuxiliaryActivityBar', comment: ['&& denotes a mnemonic'] }, "Secondary Activity Bar"), //TODO@softwarenerd assign mnemonic.
				original: 'Toggle Secondary Activity Bar Visibility'
			},
			category: CATEGORIES.View,
			f1: true,
			toggled: AuxiliaryActivityBarVisibleContext,
			menu: [{
				id: MenuId.MenubarAppearanceMenu,
				group: '1_workbench_layout',
				order: 1
			}]
		});
	}

	run(accessor: ServicesAccessor): void {
		const layoutService = accessor.get(IWorkbenchLayoutService);
		layoutService.setPartHidden(layoutService.isVisible(Parts.AUXILIARYACTIVITYBAR_PART), Parts.AUXILIARYACTIVITYBAR_PART);
	}
}

registerAction2(ToggleAuxiliaryActivityBarVisibilityAction);

// Focus is a work in progress...
registerAction2(class FocusAuxiliaryActivityBarAction extends Action2 {

	static readonly ID = 'workbench.action.focusAuxiliaryActivityBar';

	constructor() {
		super({
			id: FocusAuxiliaryActivityBarAction.ID,
			title: {
				value: localize('focusAuxiliaryActivityBar', "Focus Secondary Activity Bar"),
				original: 'Focus Secondary Activity Bar'
			},
			category: CATEGORIES.View,
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const layoutService = accessor.get(IWorkbenchLayoutService);
		layoutService.focusPart(Parts.AUXILIARYACTIVITYBAR_PART);
	}
});

registerAction2(class ShowEnvironmentAuxiliaryActivityAction extends Action2 {

	static readonly ID = 'workbench.action.showEnvironmentAuxiliaryActivity';

	constructor() {
		super({
			id: ShowEnvironmentAuxiliaryActivityAction.ID,
			title: {
				value: localize('showEnvironmentAuxiliaryActivity', "Show Environment"),
				original: 'Show Environment'
			},
			category: CATEGORIES.View,
			f1: true,
		});
	}

	run(accessor: ServicesAccessor): void {
		const auxiliaryActivityBarService = accessor.get(IAuxiliaryActivityBarService);
		auxiliaryActivityBarService.showEnvironmentAuxiliaryActivity();
	}
});

registerAction2(class ShowPreviewAuxiliaryActivityAction extends Action2 {

	static readonly ID = 'workbench.action.showPreviewAuxiliaryActivity';

	constructor() {
		super({
			id: ShowPreviewAuxiliaryActivityAction.ID,
			title: {
				value: localize('showPreviewAuxiliaryActivity', "Show Preview"),
				original: 'Show Preview'
			},
			category: CATEGORIES.View,
			f1: true,
		});
	}

	run(accessor: ServicesAccessor): void {
		const auxiliaryActivityBarService = accessor.get(IAuxiliaryActivityBarService);
		auxiliaryActivityBarService.showPreviewAuxiliaryActivity();
	}
});

registerAction2(class ShowHelpAuxiliaryActivityAction extends Action2 {

	static readonly ID = 'workbench.action.showHelpAuxiliaryActivity';

	constructor() {
		super({
			id: ShowHelpAuxiliaryActivityAction.ID,
			title: {
				value: localize('showHelpAuxiliaryActivity', "Show Help"),
				original: 'Show Help'
			},
			category: CATEGORIES.View,
			f1: true,
		});
	}

	run(accessor: ServicesAccessor): void {
		const auxiliaryActivityBarService = accessor.get(IAuxiliaryActivityBarService);
		auxiliaryActivityBarService.showHelpAuxiliaryActivity();
	}
});

registerAction2(class ShowPlotAuxiliaryActivityAction extends Action2 {

	static readonly ID = 'workbench.action.showPlotAuxiliaryActivity';

	constructor() {
		super({
			id: ShowPlotAuxiliaryActivityAction.ID,
			title: {
				value: localize('showPlotAuxiliaryActivity', "Show Plot"),
				original: 'Show Plot'
			},
			category: CATEGORIES.View,
			f1: true,
		});
	}

	run(accessor: ServicesAccessor): void {
		const auxiliaryActivityBarService = accessor.get(IAuxiliaryActivityBarService);
		auxiliaryActivityBarService.showPlotAuxiliaryActivity();
	}
});

registerAction2(class ShowViewerAuxiliaryActivityAction extends Action2 {

	static readonly ID = 'workbench.action.showViewerAuxiliaryActivity';

	constructor() {
		super({
			id: ShowViewerAuxiliaryActivityAction.ID,
			title: {
				value: localize('showViewerAuxiliaryActivity', "Show Viewer"),
				original: 'Show Viewer'
			},
			category: CATEGORIES.View,
			f1: true,
		});
	}

	run(accessor: ServicesAccessor): void {
		const auxiliaryActivityBarService = accessor.get(IAuxiliaryActivityBarService);
		auxiliaryActivityBarService.showViewerAuxiliaryActivity();
	}
});

registerAction2(class ShowPresentationAuxiliaryActivityAction extends Action2 {

	static readonly ID = 'workbench.action.showPresentationAuxiliaryActivity';

	constructor() {
		super({
			id: ShowPresentationAuxiliaryActivityAction.ID,
			title: {
				value: localize('showPresentationAuxiliaryActivity', "Show Presentation"),
				original: 'Show Presentation'
			},
			category: CATEGORIES.View,
			f1: true,
		});
	}

	run(accessor: ServicesAccessor): void {
		const auxiliaryActivityBarService = accessor.get(IAuxiliaryActivityBarService);
		auxiliaryActivityBarService.showPresentationAuxiliaryActivity();
	}
});
