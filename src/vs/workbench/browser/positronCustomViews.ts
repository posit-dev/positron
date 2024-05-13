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
			'workbench.view.extension.positron-connections': ViewContainerLocation.Panel,
			'workbench.panel.positronSessions': ViewContainerLocation.Panel,
			'workbench.views.service.panel.d54dbb97-967d-4598-a183-f19c8cfc8a3a': ViewContainerLocation.Panel
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
		layoutDescriptor: sideBySideDS,
	},
	{
		id: 'heathen',
		label: localize('choseLayout.heathenLayout', 'Heathen Layout'),
		layoutDescriptor: heathenLayout,
	}
];
