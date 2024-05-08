/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { IStringDictionary } from 'vs/base/common/collections';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { IViewDescriptorService, ViewContainerLocation } from 'vs/workbench/common/views';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';


// Copied from src/vs/workbench/services/views/browser/viewDescriptorService.ts to
// avoid exporting the interface and creating more diffs

interface IViewsCustomizations {
	viewContainerLocations: IStringDictionary<ViewContainerLocation>;
	viewLocations: IStringDictionary<string>;
	viewContainerBadgeEnablementStates: IStringDictionary<boolean>;
}

interface CustomPositronLayoutDescription {
	panel: boolean;
	sideBar: boolean;
	activityBar: boolean;
	editor: boolean;
}

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

export const fourPaneDS: PositronCustomLayoutDescriptor =
{
	layout: {
		panel: true,
		sideBar: true,
		activityBar: true,
		editor: true
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
};

export const sideBySideDS: PositronCustomLayoutDescriptor =
{
	layout: {
		panel: true,
		sideBar: false,
		activityBar: false,
		editor: true
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

