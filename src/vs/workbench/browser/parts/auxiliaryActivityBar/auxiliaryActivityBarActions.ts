/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import { ServicesAccessor } from 'vs/editor/browser/editorExtensions';
import { localize } from 'vs/nls';
import { Action2, MenuId, registerAction2 } from 'vs/platform/actions/common/actions';
import { IModalDialogsService } from 'vs/platform/modalDialogs/common/modalDialogs';
import { Categories } from 'vs/platform/action/common/actionCommonCategories';
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
			category: Categories.View,
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
			category: Categories.View,
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
			category: Categories.View,
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
			category: Categories.View,
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
			category: Categories.View,
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
			category: Categories.View,
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
			category: Categories.View,
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
			category: Categories.View,
			f1: true,
		});
	}

	run(accessor: ServicesAccessor): void {
		const auxiliaryActivityBarService = accessor.get(IAuxiliaryActivityBarService);
		auxiliaryActivityBarService.showPresentationAuxiliaryActivity();
	}
});

// TEST COMMANDS.

registerAction2(class ShowExampleModalDialogAction1 extends Action2 {

	static readonly ID = 'workbench.action.showExampleModalDialog1';

	constructor() {
		super({
			id: ShowExampleModalDialogAction1.ID,
			title: {
				value: localize('showExampleModalDialog1', "Show Example Modal Dialog 1"),
				original: 'Show Example Modal Dialog 1'
			},
			category: Categories.Test,
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const modalDialogsService = accessor.get(IModalDialogsService);
		await modalDialogsService.showExampleModalDialog1('Example Modal Dialog 1 Title');
	}
});

registerAction2(class ShowExampleModalDialogAction2 extends Action2 {

	static readonly ID = 'workbench.action.showExampleModalDialog2';

	constructor() {
		super({
			id: ShowExampleModalDialogAction2.ID,
			title: {
				value: localize('showExampleModalDialog2', "Show Example Modal Dialog 2"),
				original: 'Show Example Modal Dialog 2'
			},
			category: Categories.Test,
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const modalDialogsService = accessor.get(IModalDialogsService);
		const result = await modalDialogsService.showExampleModalDialog2('Example Modal Dialog 2 Title');
		console.log(`The result of showExampleModalDialog2 was ${result}`);
	}
});
