/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/


import { ILocalizedString, localize2 } from 'vs/nls';
import { Categories } from 'vs/platform/action/common/actionCommonCategories';
import { Action2, registerAction2 } from 'vs/platform/actions/common/actions';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { IQuickPickItem } from 'vs/platform/quickinput/common/quickInput';
import { Parts } from 'vs/workbench/services/layout/browser/layoutService';
import { IPositronLayoutService } from 'vs/workbench/services/positronLayout/browser/interfaces/positronLayoutService';

// Need this import or else the PositronLayoutService will not be registered.
import 'vs/workbench/services/positronLayout/browser/positronLayoutService';
import { CustomPositronLayoutDescription } from 'vs/workbench/services/positronLayout/common/positronCustomViews';


type PositronLayoutInfo = {
	id: string;
	codicon: string;
	label: ILocalizedString;
	layoutDescriptor: CustomPositronLayoutDescription;
};

export const positronFourPaneDsLayout: PositronLayoutInfo = {
	id: 'workbench.action.positronFourPaneDataScienceLayout',
	codicon: 'positron-four-pane-ds-layout',
	label: localize2('choseLayout.stacked', 'Stacked Layout'),
	layoutDescriptor: {
		[Parts.SIDEBAR_PART]: {
			size: '15%',
			hidden: false,
		},
		[Parts.PANEL_PART]: {
			size: '40%',
			hidden: false,
			alignment: 'center',
			viewContainers: [
				{
					id: 'workbench.panel.positronConsole',
					opened: true,
				},
				{
					id: 'terminal',
				},
			]
		},
		[Parts.AUXILIARYBAR_PART]: {
			size: '30%',
			hidden: false,
			viewContainers: [
				{
					id: 'workbench.panel.positronSession',
					opened: true,
					views: [
						{
							id: 'workbench.panel.positronVariables',
						},
						{
							id: 'workbench.panel.positronPlots',
						},
					]
				},
			]
		}
	},
};

export const positronTwoPaneLayout: PositronLayoutInfo = {
	id: 'workbench.action.positronTwoPaneDataScienceLayout',
	codicon: 'positron-two-pane-ds-layout',
	label: localize2('choseLayout.sideBySide', 'Side-By-Side Layout'),
	layoutDescriptor: {
		[Parts.PANEL_PART]: {
			hidden: true,
			alignment: 'center'
		},
		[Parts.SIDEBAR_PART]: {
			hidden: true
		},
		[Parts.AUXILIARYBAR_PART]: {
			hidden: false,
			size: '40%',
			viewContainers: [
				{
					id: 'workbench.panel.positronSession',
					opened: true,
					views: [
						{
							id: 'workbench.panel.positronConsole',
						},
						{
							id: 'workbench.panel.positronVariables',
							collapsed: true,
						},
						{
							id: 'workbench.panel.positronPlots',
							collapsed: true,
						},
					]
				},
				{
					id: 'terminal',
				}
			]
		},
	},
};

export const positronNotebookLayout: PositronLayoutInfo = {
	id: 'workbench.action.positronNotebookLayout',
	codicon: 'positron-notebook-layout',
	label: localize2('chooseLayout.notebookLayout', 'Notebook Layout'),
	layoutDescriptor: {
		[Parts.PANEL_PART]: {
			size: '40%',
			hidden: true,
			alignment: 'center',
			viewContainers: [
				{
					id: 'workbench.panel.positronConsole',
					opened: true,
				},
				{
					id: 'terminal',
				},
			]
		},
		[Parts.SIDEBAR_PART]: {
			hidden: false,
			size: '15%',
			minSize: 180,
			hideIfBelowMinSize: true,
		},
		[Parts.AUXILIARYBAR_PART]: {
			hidden: true,
			size: '20%',
			minSize: 180,
		},
	},
};


abstract class PositronLayoutAction extends Action2 {
	private _layout: CustomPositronLayoutDescription;
	constructor(
		layoutInfo: PositronLayoutInfo
	) {
		super({
			id: layoutInfo.id,
			title: layoutInfo.label,
			category: Categories.View,
			f1: true,
		});

		this._layout = layoutInfo.layoutDescriptor;
	}
	run(accessor: ServicesAccessor): void {
		const positronLayoutService = accessor.get(IPositronLayoutService);
		positronLayoutService.setLayout(this._layout);
	}
}
registerAction2(class extends PositronLayoutAction {
	constructor() {
		super(positronNotebookLayout);
	}
});

registerAction2(class extends PositronLayoutAction {
	constructor() {
		super(positronTwoPaneLayout);
	}
});

registerAction2(class extends PositronLayoutAction {
	constructor() {
		super(positronFourPaneDsLayout);
	}
});


// Action to dump json of the current layout to the console for creation of a custom layout.
// registerAction2(class DumpViewCustomizations extends Action2 {

// 	constructor() {
// 		super({
// 			id: 'workbench.action.dumpViewCustomizations',
// 			title: localize2('dumpViewCustomizations', "Dump view customizations to console"),
// 			category: Categories.View,
// 			f1: true,
// 		});
// 	}

// 	run(accessor: ServicesAccessor): void {
// 		console.log(
// 			JSON.stringify(createPositronCustomLayoutDescriptor(accessor), null, 2)
// 		);
// 	}
// });

type LayoutPick = IQuickPickItem & { layoutDescriptor: CustomPositronLayoutDescription };

export const positronCustomLayoutOptions: LayoutPick[] = [
	positronFourPaneDsLayout,
	positronTwoPaneLayout,
	positronNotebookLayout
].map(function positronLayoutInfoToQuickPick(layoutInfo: PositronLayoutInfo): LayoutPick {
	return {
		id: layoutInfo.id,
		label: `$(${layoutInfo.codicon}) ${layoutInfo.label.value}`,
		layoutDescriptor: layoutInfo.layoutDescriptor,
	};
});

