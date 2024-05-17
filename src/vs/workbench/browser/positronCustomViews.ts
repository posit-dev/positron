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

/**
 * Known parts that can be customized in for layouts.
 */
export type KnownPositronLayoutParts = Parts.PANEL_PART | Parts.SIDEBAR_PART | Parts.AUXILIARYBAR_PART;

/**
 * Description of the custom layout for a given part (e.g. Sidebar, Panel, ...) of the editor.
 */
export type PartLayoutDescription = {
	/**
	 * Size of the part. If a number, it's an absolute size in pixels. If it's a string it's a
	 * relative size in percentage of the viewport size. If the size controls the width or the
	 * height depends on the part. E.g. for the sidebar it's the width.
	 */
	size?: number | `${number}%`;
	/**
	 * Should this part be hidden by default?
	 */
	hidden: boolean;
	/**
	 * Alignment of the part. Only used for the panel part.
	 */
	alignment?: PanelAlignment;
	/**
	 * Description of the view containers in this part. The order as they appear in the array
	 * will be the order they are shown in the UI. Any non-specified view containers will be
	 * added after the specified ones.
	 */
	viewContainers?: ViewContainerLayoutDescription[];
};

/**
 * Description of a view container within an editor part. E.g. the "Sessions" tab.
 */
type ViewContainerLayoutDescription = {
	/**
	 * Id of this view container. This is the id that the view container is registered with.
	 * E.g. `workbench.panel.positronSession`.
	 */
	id: string;
	/**
	 * Is this view container shown? Only one of these can be shown at a time so if multiple are
	 * set, the last one will be respected.
	 */
	opened?: boolean;
	/**
	 * Description of the views within this view container. The order as they appear in the array
	 * will be the order they are shown in the UI. Any non-specified views will be added after the
	 * specified ones.
	 */
	views?: ViewLayoutDescription[];
};

export type ViewLayoutDescription = {
	/**
	 * Id of this view. This is the id that the view is registered with.
	 * E.g. `workbench.panel.positronPlots` or `terminal`.
	 */
	id: string;
	/**
	 * Size units are relative. Every view sharing the same `relativeSize` will have the same size.
	 * If not provided, will default to 1.
	 */
	relativeSize?: number;
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
				'hidden': false,
				viewContainers: [
					{
						id: 'workbench.panel.positronSession',
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
	},
	{
		id: 'side-by-side',
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
						id: 'workbench.panel.positronConsole',
						views: [
							{
								id: 'workbench.panel.positronConsole',
								relativeSize: 1,
							},
							{
								id: 'workbench.panel.positronPlots',
								relativeSize: 1,
							},
						]
					},
					{
						id: 'workbench.panel.positronSession',
					},
				]
			},
		},
	},
	{
		id: 'side-by-side-console-only',
		label: localize('choseLayout.sideBySideConsole', 'Side-by-side Data Science (Console Only)'),
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
						id: 'workbench.panel.positronConsole',
						opened: true,
						views: [
							{
								id: 'workbench.panel.positronConsole',
								relativeSize: 1,
							},
						]
					},
					{
						id: 'workbench.panel.positronSession',
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
			},
		},
	},

];
