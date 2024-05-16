/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ISerializableView, IViewSize } from 'vs/base/browser/ui/grid/gridview';
import { IStringDictionary } from 'vs/base/common/collections';
import { localize } from 'vs/nls';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { IQuickPickItem } from 'vs/platform/quickinput/common/quickInput';
import { IViewDescriptorService, ViewContainerLocation } from 'vs/workbench/common/views';
import { IWorkbenchLayoutService, PanelAlignment, Parts } from 'vs/workbench/services/layout/browser/layoutService';

export type KnownPositronLayoutParts = Parts.PANEL_PART | Parts.SIDEBAR_PART | Parts.AUXILIARYBAR_PART;

/**
 * Description of the custom layout for a given part (e.g. Sidebar, Panel, ...) of the editor.
 */
export type PartLayoutDescription = {
	size?: number | `${number}%`;
	hidden: boolean;
	alignment?: PanelAlignment;
	viewContainers?: {
		id: string;
		// Is this view container shown? Only one of these can be shown at a time so if
		// multiple are set, the last one will be respected.
		opened?: boolean;
		// Size units are relative. Every view sharing the same sizeUnit will have the same size.
		// if not provided, will default to 1.
		views?: { id: string; sizeUnit?: number }[];
	}[];
};

/**
 * Full description of custom layout for the editor.
 */
export type CustomPositronLayoutDescription = Record<
	KnownPositronLayoutParts,
	PartLayoutDescription
>;


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


export function viewLocationsToViewOrder(viewLocations: IStringDictionary<string>) {
	const viewOrder: IStringDictionary<string[]> = {};
	for (const viewId in viewLocations) {
		const containerId = viewLocations[viewId];
		if (!viewOrder[containerId]) {
			viewOrder[containerId] = [];
		}
		viewOrder[containerId].push(viewId);
	}
	return viewOrder;
}

/**
 * Mapping of the layout part to what size we want to resize with the `size` parameter of the layout
 * description. E.g. the panel is resized by changing its height.
 */
export const viewPartToResizeDimension: Record<KnownPositronLayoutParts, 'width' | 'height'> = {
	[Parts.PANEL_PART]: 'height',
	[Parts.SIDEBAR_PART]: 'width',
	[Parts.AUXILIARYBAR_PART]: 'width',
};

/**
 * Convenience function to load a custom layout and views from a descriptor.
 * @param description Description of the custom layout and views
 * @param accessor Services accessor
 */
export function loadCustomPositronLayout(description: CustomPositronLayoutDescription, accessor: ServicesAccessor) {
	accessor.get(IWorkbenchLayoutService).enterCustomLayout(description);
	accessor.get(IViewDescriptorService).loadCustomViewDescriptor(description);
}

// Currently not in use because the layout description format is in flux and so it's hard to keep
// this synced.
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


type LayoutPick = IQuickPickItem & { layoutDescriptor: CustomPositronLayoutDescription };
export const positronCustomLayoutOptions: LayoutPick[] = [
	{
		id: 'fourPaneDS',
		label: localize('choseLayout.fourPaneDS', 'Four Pane Data Science'),
		layoutDescriptor: {
			[Parts.SIDEBAR_PART]: {
				size: 150,
				'hidden': true,
			},
			[Parts.PANEL_PART]: {
				size: 400,
				'hidden': false,
				'alignment': 'center',
				viewContainers: [
					{
						id: 'workbench.panel.positronConsole',
					},
				]
			},
			[Parts.AUXILIARYBAR_PART]: {
				size: 700,
				'hidden': false,
				viewContainers: [
					{
						id: 'workbench.panel.positronSession',
					},
				]
			}
		},
	},
	{
		id: 'plot-console-variables',
		label: localize('choseLayout.plotConsoleVariables', 'Plot, Console, Variables'),
		layoutDescriptor: {
			[Parts.PANEL_PART]: {
				hidden: true,
				alignment: 'center'
			},
			[Parts.SIDEBAR_PART]: {
				hidden: true
			},
			[Parts.AUXILIARYBAR_PART]: {
				// Dont hide the auxiliary bar
				hidden: false,
				size: '50%',
				// Add the positron session view container in the first position
				viewContainers: [
					{
						id: 'workbench.panel.positronSession',
						// Order the following views in the positron session view container
						views: [
							{
								id: 'workbench.panel.positronPlots',
								sizeUnit: 2,
							},
							{
								id: 'workbench.panel.positronConsole',
								sizeUnit: 1,
							},
							{
								id: 'workbench.panel.positronVariables',
							}
						]
					},
					// Add the terminal in the second position with default views.
					{
						id: 'terminal',
						opened: true,
					}
				]
			},
		},
	},
	// {
	// 	id: 'sideBySideDS',
	// 	label: localize('choseLayout.sideBySideDS', 'Side by Side Data Science'),
	// 	layoutDescriptor: {
	// 		layout: {
	// 			[Parts.PANEL_PART]: {
	// 				hidden: true,
	// 				alignment: 'center',
	// 				viewContainers: [
	// 					{
	// 						id: 'workbench.panel.positronSessions',
	// 						views: ['workbench.panel.positronConsole']
	// 					}
	// 				]
	// 			 },
	// 			[Parts.SIDEBAR_PART]: { hidden: true },
	// 			[Parts.AUXILIARYBAR_PART]: { hidden: false },
	// 		},
	// 		views: {
	// 			'viewContainerLocations': {
	// 				'workbench.view.extension.positron-connections': 1,
	// 				'workbench.panel.positronSessions': 1
	// 			},
	// 			viewOrder: {
	// 				'workbench.view.explorer': [
	// 					'connections'

	// 				],
	// 				'workbench.panel.positronSessions': [
	// 					'workbench.panel.positronConsole',
	// 				]
	// 			},
	// 		}
	// 	},
	// },

	// {
	// 	id: 'heathen',
	// 	label: localize('choseLayout.heathenLayout', 'Heathen Layout'),
	// 	layoutDescriptor: {
	// 		'layout': {
	// 			'workbench.parts.sidebar': {
	// 				'hidden': true
	// 			},
	// 			'workbench.parts.panel': {
	// 				'height': 734,
	// 				'hidden': false,
	// 				alignment: 'center'
	// 			},
	// 			'workbench.parts.auxiliarybar': {
	// 				'hidden': true
	// 			}
	// 		},
	// 		'views': {
	// 			'viewContainerLocations': {
	// 				'workbench.view.extension.positron-connections': 1,
	// 				'workbench.panel.positronSessions': 1,
	// 			},
	// 			viewOrder: {
	// 				'workbench.panel.positronSessions': [
	// 					'workbench.panel.positronConsole',
	// 					'workbench.panel.positronVariables',
	// 					'terminal'
	// 				],
	// 				'workbench.view.explorer': [
	// 					'connections'
	// 				]
	// 			},
	// 		}
	// 	},
	// }
];
