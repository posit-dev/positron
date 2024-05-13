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


// Copied from src/vs/workbench/services/views/browser/viewDescriptorService.ts to
// avoid exporting the interface and creating more diffs
export interface IPositronViewCustomizations {
	viewContainerLocations: IStringDictionary<ViewContainerLocation>;
	viewLocations: IStringDictionary<string>;
	viewContainerBadgeEnablementStates: IStringDictionary<boolean>;
	// Our own logic here
	viewOptions?: IStringDictionary<{ indexInContainer?: number; expanded?: boolean }>;
}

export interface PartLayoutDescription {
	width?: number;
	height?: number;
	hidden: boolean;
}

interface PanelLayoutDescription extends PartLayoutDescription {
	alignment: PanelAlignment;
}


export interface CustomPositronLayoutDescription {
	[Parts.PANEL_PART]: PanelLayoutDescription;
	[Parts.SIDEBAR_PART]: PartLayoutDescription;
	[Parts.AUXILIARYBAR_PART]: PartLayoutDescription;
}

export type PartViewInfo = {
	partView: ISerializableView;
	currentSize: IViewSize;
	alignment?: PanelAlignment;
	hidden: boolean;
	hideFn: (hidden: boolean, skipLayout?: boolean | undefined) => void;
};

export type KnownPositronLayoutParts = keyof CustomPositronLayoutDescription;


// export interface IPositronViewCustomizations extends IViewsCustomizations {
// 	viewOptions?: {
// 		[viewId: string]: { indexInContainer?: number; expanded?: boolean };
// 	};
// }
export interface PositronCustomLayoutDescriptor {
	layout: CustomPositronLayoutDescription;
	views: IPositronViewCustomizations;
}

/**
 * Convenience function to load a custom layout and views from a descriptor.
 * @param description Description of the custom layout and views
 * @param accessor Services accessor
 */
export function loadCustomPositronLayout(description: PositronCustomLayoutDescriptor, accessor: ServicesAccessor) {
	accessor.get(IWorkbenchLayoutService).enterCustomLayout(description.layout);
	accessor.get(IViewDescriptorService).loadCustomViewDescriptor(description.views);
}

export function createPositronCustomLayoutDescriptor(accessor: ServicesAccessor): PositronCustomLayoutDescriptor {
	const views = accessor.get(IViewDescriptorService).dumpViewCustomizations();
	const layoutService = accessor.get(IWorkbenchLayoutService);

	const getPartLayout = (part: KnownPositronLayoutParts) => {
		const { currentSize, hidden } = layoutService.getPartViewInfo(part);
		return { width: currentSize.width, height: currentSize.height, hidden };
	};

	return {
		layout: {
			[Parts.SIDEBAR_PART]: getPartLayout(Parts.SIDEBAR_PART),
			[Parts.PANEL_PART]: getPartLayout(Parts.PANEL_PART) as PanelLayoutDescription,
			[Parts.AUXILIARYBAR_PART]: getPartLayout(Parts.AUXILIARYBAR_PART),
		},
		views
	};
}

export const fourPaneDS: PositronCustomLayoutDescriptor = {
	'layout': {
		'workbench.parts.sidebar': {
			'width': 150,
			'hidden': true
		},
		'workbench.parts.panel': {
			'height': 400,
			'hidden': false,
			'alignment': 'center'
		},
		'workbench.parts.auxiliarybar': {
			'width': 700,
			'hidden': false
		}
	},
	'views': {
		'viewContainerLocations': {
			'workbench.view.extension.positron-connections': 1,
			'workbench.panel.positronSessions': 1,
			'workbench.views.service.panel.f732882e-ffdb-495b-b500-31b109474b78': 1
		},
		'viewLocations': {
			'connections': 'workbench.view.explorer',
			'workbench.panel.positronConsole': 'workbench.views.service.panel.f732882e-ffdb-495b-b500-31b109474b78'
		},
		'viewContainerBadgeEnablementStates': {}
	}
};



export const heathenLayout: PositronCustomLayoutDescriptor = {
	'layout': {
		'workbench.parts.sidebar': {
			'hidden': true
		},
		'workbench.parts.panel': {
			'height': 734,
			'hidden': false,
			alignment: 'center'
		},
		'workbench.parts.auxiliarybar': {
			'hidden': true
		}
	},
	'views': {
		'viewContainerLocations': {
			'workbench.view.extension.positron-connections': 1,
			'workbench.panel.positronSessions': 1,
		},
		'viewLocations': {
			'connections': 'workbench.view.explorer',
			'workbench.panel.positronConsole': 'workbench.panel.positronSessions',
			'workbench.panel.positronVariables': 'workbench.panel.positronSessions',
			'terminal': 'workbench.panel.positronSessions'
		},
		'viewContainerBadgeEnablementStates': {}
	}
};

type LayoutPick = IQuickPickItem & { layoutDescriptor: PositronCustomLayoutDescriptor };
export const positronCustomLayoutOptions: LayoutPick[] = [
	{
		id: 'fourPaneDS',
		label: localize('choseLayout.fourPaneDS', 'Four Pane Data Science'),
		layoutDescriptor: fourPaneDS,
	},
	{
		id: 'sideBySideDS',
		label: localize('choseLayout.sideBySideDS', 'Side by Side Data Science'),
		layoutDescriptor: {
			layout: {
				[Parts.PANEL_PART]: { hidden: true, alignment: 'center' },
				[Parts.SIDEBAR_PART]: { hidden: true },
				[Parts.AUXILIARYBAR_PART]: { hidden: false },
			},
			views: {
				'viewContainerLocations': {
					'workbench.view.extension.positron-connections': 1,
					'workbench.panel.positronSessions': 1
				},
				'viewLocations': {
					'connections': 'workbench.view.explorer',
					'workbench.panel.positronConsole': 'workbench.panel.positronVariables'
				},
				'viewContainerBadgeEnablementStates': {}
			}
		},
	},
	{
		id: 'plot-console-variables',
		label: localize('choseLayout.plotConsoleVariables', 'Plot, Console, Variables'),
		layoutDescriptor: {
			layout: {
				[Parts.PANEL_PART]: { hidden: true, alignment: 'center' },
				[Parts.SIDEBAR_PART]: { hidden: true },
				[Parts.AUXILIARYBAR_PART]: { hidden: false },
			},
			views: {
				'viewContainerLocations': {
					'workbench.view.extension.positron-connections': 1,
					'workbench.panel.positronSessions': 1
				},
				'viewLocations': {
					'connections': 'workbench.view.explorer',
					'workbench.panel.positronPlots': 'workbench.panel.positronVariables',
					'workbench.panel.positronConsole': 'workbench.panel.positronVariables',
					'workbench.panel.positronVariables': 'workbench.panel.positronVariables',
				},
				'viewContainerBadgeEnablementStates': {},
				viewOptions: {
					'workbench.panel.positronPlots': { indexInContainer: 0, expanded: true },
					'workbench.panel.positronConsole': { indexInContainer: 1, expanded: true },
					'workbench.panel.positronVariables': { indexInContainer: 2, expanded: true }
				}
			},
		},
	},
	{
		id: 'heathen',
		label: localize('choseLayout.heathenLayout', 'Heathen Layout'),
		layoutDescriptor: heathenLayout,
	}
];
