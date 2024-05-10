/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ISerializableView, IViewSize } from 'vs/base/browser/ui/grid/gridview';
import { IStringDictionary } from 'vs/base/common/collections';
// import { localize2 } from 'vs/nls';
// import { Categories } from 'vs/platform/action/common/actionCommonCategories';
// import { Action2, registerAction2 } from 'vs/platform/actions/common/actions';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { IViewDescriptorService, ViewContainerLocation } from 'vs/workbench/common/views';
import { IWorkbenchLayoutService, PanelAlignment, Parts } from 'vs/workbench/services/layout/browser/layoutService';


// Copied from src/vs/workbench/services/views/browser/viewDescriptorService.ts to
// avoid exporting the interface and creating more diffs
interface IViewsCustomizations {
	viewContainerLocations: IStringDictionary<ViewContainerLocation>;
	viewLocations: IStringDictionary<string>;
	viewContainerBadgeEnablementStates: IStringDictionary<boolean>;
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

export interface PositronCustomLayoutDescriptor {
	layout: CustomPositronLayoutDescription;
	views: IViewsCustomizations;
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


export const sideBySideDS: PositronCustomLayoutDescriptor =
{
	layout: {
		[Parts.PANEL_PART]: { hidden: true, alignment: 'center' },
		[Parts.SIDEBAR_PART]: { hidden: true },
		[Parts.AUXILIARYBAR_PART]: { hidden: false },
	},
	views: {
		'viewContainerLocations': {
			'workbench.view.extension.positron-connections': 1,
			'workbench.panel.positronSessions': 1,
			'workbench.views.service.panel.d54dbb97-967d-4598-a183-f19c8cfc8a3a': 1
		},
		'viewLocations': {
			'connections': 'workbench.views.service.panel.d54dbb97-967d-4598-a183-f19c8cfc8a3a',
			'workbench.panel.positronConsole': 'workbench.panel.positronVariables'
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
			'workbench.views.service.panel.f732882e-ffdb-495b-b500-31b109474b78': 1,
			'workbench.views.service.panel.925bfe8a-2a2a-4038-83de-e8ebf53cfdc8': 1
		},
		'viewLocations': {
			'connections': 'workbench.view.explorer',
			'workbench.panel.positronConsole': 'workbench.views.service.panel.f732882e-ffdb-495b-b500-31b109474b78',
			'workbench.panel.positronVariables': 'workbench.views.service.panel.925bfe8a-2a2a-4038-83de-e8ebf53cfdc8'
		},
		'viewContainerBadgeEnablementStates': {}
	}
};


// registerAction2(class EnterFourPaneDataScienceLayout extends Action2 {

// 	constructor() {
// 		super({
// 			id: 'workbench.action.fourPaneDataScienceMode',
// 			title: localize2('toggle4Pane', "Toggle Four-Pane Data Science Mode"),
// 			category: Categories.View,
// 			f1: true,
// 		});
// 	}

// 	run(accessor: ServicesAccessor): void {
// 		loadCustomPositronLayout(fourPaneDS, accessor);
// 	}
// });

// registerAction2(class EnterSideBySideDSLayout extends Action2 {

// 	constructor() {
// 		super({
// 			id: 'workbench.action.sideBySideDataScienceMode',
// 			title: localize2('toggleSideBySide', 'Toggle Side-by-Side Data Science Mode'),
// 			category: Categories.View,
// 			f1: true,
// 		});
// 	}

// 	run(accessor: ServicesAccessor): void {
// 		loadCustomPositronLayout(sideBySideDS, accessor);
// 	}
// });

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
