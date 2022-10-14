/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { ServicesAccessor } from 'vs/editor/browser/editorExtensions';
import { ToolsBarVisibleContext } from 'vs/workbench/common/contextkeys';
import { Categories } from 'vs/platform/action/common/actionCommonCategories';
import { Action2, MenuId, registerAction2 } from 'vs/platform/actions/common/actions';
import { IWorkbenchLayoutService, Parts } from 'vs/workbench/services/layout/browser/layoutService';
import { IPositronModalDialogsService } from 'vs/platform/positronModalDialogs/common/positronModalDialogs';
import { IPositronToolsBarService } from 'vs/workbench/services/positronToolsBar/browser/positronToolsBarService';

export class ToggleToolsBarVisibilityAction extends Action2 {
	static readonly ID = 'workbench.action.toggleToolsBarVisibility';

	constructor() {
		super({
			id: ToggleToolsBarVisibilityAction.ID,
			title: {
				value: localize('toggleToolsBarVisibility', "Toggle Tools Bar Visibility"),
				mnemonicTitle: localize({ key: 'miToolsBar', comment: ['&& denotes a mnemonic'] }, "Tools Bar"), //TODO@softwarenerd assign mnemonic.
				original: 'Toggle Tools Bar Visibility'
			},
			category: Categories.View,
			f1: true,
			toggled: ToolsBarVisibleContext,
			menu: [{
				id: MenuId.MenubarAppearanceMenu,
				group: '1_workbench_layout',
				order: 1
			}]
		});
	}

	run(accessor: ServicesAccessor): void {
		const layoutService = accessor.get(IWorkbenchLayoutService);
		layoutService.setPartHidden(layoutService.isVisible(Parts.POSITRON_TOOLS_BAR_PART), Parts.POSITRON_TOOLS_BAR_PART);
	}
}

registerAction2(ToggleToolsBarVisibilityAction);

// Focus is a work in progress...
registerAction2(class FocusToolsBarAction extends Action2 {

	static readonly ID = 'workbench.action.focusToolsBar';

	constructor() {
		super({
			id: FocusToolsBarAction.ID,
			title: {
				value: localize('focusToolsBar', "Focus Tools Bar"),
				original: 'Focus Tools Bar'
			},
			category: Categories.View,
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const layoutService = accessor.get(IWorkbenchLayoutService);
		layoutService.focusPart(Parts.POSITRON_TOOLS_BAR_PART);
	}
});

registerAction2(class ShowEnvironmentAction extends Action2 {

	static readonly ID = 'workbench.action.showEnvironment';

	constructor() {
		super({
			id: ShowEnvironmentAction.ID,
			title: {
				value: localize('showEnvironment', "Show Environment"),
				original: 'Show Environment'
			},
			category: Categories.View,
			f1: true,
		});
	}

	run(accessor: ServicesAccessor): void {
		const positronToolsBarService = accessor.get(IPositronToolsBarService);
		positronToolsBarService.showEnvironment();
	}
});

registerAction2(class ShowPreviewAction extends Action2 {

	static readonly ID = 'workbench.action.showPreview';

	constructor() {
		super({
			id: ShowPreviewAction.ID,
			title: {
				value: localize('showPreview', "Show Preview"),
				original: 'Show Preview'
			},
			category: Categories.View,
			f1: true,
		});
	}

	run(accessor: ServicesAccessor): void {
		const positronToolsBarService = accessor.get(IPositronToolsBarService);
		positronToolsBarService.showPreview();
	}
});

registerAction2(class ShowHelpAction extends Action2 {

	static readonly ID = 'workbench.action.showHelp';

	constructor() {
		super({
			id: ShowHelpAction.ID,
			title: {
				value: localize('showHelp', "Show Help"),
				original: 'Show Help'
			},
			category: Categories.View,
			f1: true,
		});
	}

	run(accessor: ServicesAccessor): void {
		const positronToolsBarService = accessor.get(IPositronToolsBarService);
		positronToolsBarService.showHelp();
	}
});

registerAction2(class ShowPlotAction extends Action2 {

	static readonly ID = 'workbench.action.showPlot';

	constructor() {
		super({
			id: ShowPlotAction.ID,
			title: {
				value: localize('showPlot', "Show Plot"),
				original: 'Show Plot'
			},
			category: Categories.View,
			f1: true,
		});
	}

	run(accessor: ServicesAccessor): void {
		const positronToolsBarService = accessor.get(IPositronToolsBarService);
		positronToolsBarService.showPlot();
	}
});

registerAction2(class ShowViewerAction extends Action2 {

	static readonly ID = 'workbench.action.showViewer';

	constructor() {
		super({
			id: ShowViewerAction.ID,
			title: {
				value: localize('showViewer', "Show Viewer"),
				original: 'Show Viewer'
			},
			category: Categories.View,
			f1: true,
		});
	}

	run(accessor: ServicesAccessor): void {
		const positronToolsBarService = accessor.get(IPositronToolsBarService);
		positronToolsBarService.showViewer();
	}
});

registerAction2(class ShowPresentationAction extends Action2 {

	static readonly ID = 'workbench.action.showPresentation';

	constructor() {
		super({
			id: ShowPresentationAction.ID,
			title: {
				value: localize('showPresentation', "Show Presentation"),
				original: 'Show Presentation'
			},
			category: Categories.View,
			f1: true,
		});
	}

	run(accessor: ServicesAccessor): void {
		const positronToolsBarService = accessor.get(IPositronToolsBarService);
		positronToolsBarService.showPresentation();
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
		const positronModalDialogsService = accessor.get(IPositronModalDialogsService);
		await positronModalDialogsService.showExampleModalDialog1('Example Modal Dialog 1 Title');
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
		const positronModalDialogsService = accessor.get(IPositronModalDialogsService);
		const result = await positronModalDialogsService.showExampleModalDialog2('Example Modal Dialog 2 Title');
		console.log(`The result of showExampleModalDialog2 was ${result}`);
	}
});
