/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/


import { ISerializableView, IViewSize } from 'vs/base/browser/ui/grid/gridview';
import { ILocalizedString, localize2 } from 'vs/nls';
import { Categories } from 'vs/platform/action/common/actionCommonCategories';
import { Action2, registerAction2 } from 'vs/platform/actions/common/actions';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { IQuickPickItem } from 'vs/platform/quickinput/common/quickInput';
import { CustomPositronLayoutDescription, KnownPositronLayoutParts } from 'vs/workbench/common/positronCustomViews';
import { IViewDescriptorService, ViewContainerLocation } from 'vs/workbench/common/views';
import { IWorkbenchLayoutService, PanelAlignment, Parts } from 'vs/workbench/services/layout/browser/layoutService';


export type PartViewInfo = {
	partView: ISerializableView;
	currentSize: IViewSize;
	alignment?: PanelAlignment;
	hidden: boolean;
	hideFn: (hidden: boolean, skipLayout?: boolean | undefined) => void;
};

const partToViewContainerLocation: Record<KnownPositronLayoutParts, ViewContainerLocation> = {
	[Parts.PANEL_PART]: ViewContainerLocation.Panel,
	[Parts.SIDEBAR_PART]: ViewContainerLocation.Sidebar,
	[Parts.AUXILIARYBAR_PART]: ViewContainerLocation.AuxiliaryBar,
};

/**
 * Convert our custom layout description to the `IViewsCustomizations` format that the
 * `viewDescriptorService` uses for its internal state.
 * @param layout Positron custom layout description
 * @returns Simplified view info in the form of viewContainerLocations and
 * viewDescriptorCustomizations. See `IViewsCustomizations` for more info.
 */
export function layoutDescriptionToViewInfo(layout: CustomPositronLayoutDescription) {
	const viewContainerLocations = new Map<string, ViewContainerLocation>();
	const viewDescriptorCustomizations = new Map<string, string>();

	for (const [part, info] of Object.entries(layout)) {
		const viewContainers = info.viewContainers;
		if (!viewContainers) { continue; }
		const viewContainerLocation = partToViewContainerLocation[part as KnownPositronLayoutParts];

		for (const viewContainer of viewContainers) {
			viewContainerLocations.set(viewContainer.id, viewContainerLocation);

			if (!viewContainer.views) { continue; }
			for (const view of viewContainer.views) {
				viewDescriptorCustomizations.set(view.id, viewContainer.id);
			}
		}
	}

	return {
		viewContainerLocations,
		viewDescriptorCustomizations,
	};
}


// export function createPositronCustomLayoutDescriptor(accessor: ServicesAccessor): CustomPositronLayoutDescription {
// 	const views = accessor.get(IViewDescriptorService).dumpViewCustomizations();
// 	const layoutService = accessor.get(IWorkbenchLayoutService);

// 	const getPartLayout = (part: KnownPositronLayoutParts) => {
// 		const { currentSize, hidden } = layoutService.getPartViewInfo(part);
// 		return { width: currentSize.width, height: currentSize.height, hidden };
// 	};

// 	return {
// 		[Parts.SIDEBAR_PART]: getPartLayout(Parts.SIDEBAR_PART),
// 		[Parts.PANEL_PART]: getPartLayout(Parts.PANEL_PART),
// 		[Parts.AUXILIARYBAR_PART]: getPartLayout(Parts.AUXILIARYBAR_PART),
// 	};
// }


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
		const layoutService = accessor.get(IWorkbenchLayoutService);
		const viewDescriptorService = accessor.get(IViewDescriptorService);

		viewDescriptorService.loadCustomViewDescriptor(this._layout);
		// Run the layout service action after the view descriptor has been loaded.
		// This is needed so that the changing of the contents of the parts doesn't
		// break the currently open view container that is set by the layoutService.
		layoutService.enterCustomLayout(this._layout);
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

