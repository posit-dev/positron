/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/


import { ISerializableView, IViewSize } from 'vs/base/browser/ui/grid/gridview';
import { localize } from 'vs/nls';
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

// const fourPaneLayoutIcon = registerIcon('positron-four-pane-ds-layout', Codicon.positronFourPaneDsLayout, localize('icon.fourPaneLayout', "Represents the four pane layout for data science."));


type PositronLayoutInfo = {
	id: string;
	codicon: string;
	label: string;
	layoutDescriptor: CustomPositronLayoutDescription;
};

function positronLayoutInfoToQuickPick(layoutInfo: PositronLayoutInfo): LayoutPick {
	return {
		id: layoutInfo.id,
		label: `$(${layoutInfo.codicon}) ${layoutInfo.label}`,
		layoutDescriptor: layoutInfo.layoutDescriptor,
	};
}

type LayoutPick = IQuickPickItem & { layoutDescriptor: CustomPositronLayoutDescription };

export const positronFourPaneDsLayout: PositronLayoutInfo = {
	id: 'workbench.action.positronFourPaneDataScienceLayout',
	codicon: 'positron-four-pane-ds-layout',
	label: localize('choseLayout.fourPaneDS', 'Four Pane Data Science'),
	layoutDescriptor: {
		[Parts.SIDEBAR_PART]: {
			size: 200,
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
			size: 500, // Use pixel sizes for auxiliary bar to allow editor to take up the rest of the space
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
	label: localize('choseLayout.sideBySide', 'Side-by-side Data Science'),
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
			size: '50%',
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
						},
						{
							id: 'workbench.panel.positronPlots',
							collapsed: true,
						},
					]
				},
			]
		},
	},
};

export const positronCustomLayoutOptions: LayoutPick[] = [
	positronFourPaneDsLayout,
	positronTwoPaneLayout
].map(positronLayoutInfoToQuickPick);

export function enterPositronLayout(layout: CustomPositronLayoutDescription, layoutService: IWorkbenchLayoutService, viewDescriptorService: IViewDescriptorService) {
	viewDescriptorService.loadCustomViewDescriptor(layout);
	// Run the layout service action after the view descriptor has been loaded.
	// This is needed so that the changing of the contents of the parts doesn't
	// break the currently open view container that is set by the layoutService.
	layoutService.enterCustomLayout(layout);
}
