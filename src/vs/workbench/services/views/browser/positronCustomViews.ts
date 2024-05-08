/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { IStringDictionary } from 'vs/base/common/collections';
import { ViewContainerLocation } from 'vs/workbench/common/views';


// Copied from src/vs/workbench/services/views/browser/viewDescriptorService.ts to
// avoid exporting the interface and creating more diffs

interface IViewsCustomizations {
	viewContainerLocations: IStringDictionary<ViewContainerLocation>;
	viewLocations: IStringDictionary<string>;
	viewContainerBadgeEnablementStates: IStringDictionary<boolean>;
}

export const fourPaneDS: IViewsCustomizations = {
	'viewContainerLocations': {
		'workbench.view.extension.positron-connections': 1,
		'workbench.panel.positronSessions': 1
	},
	'viewLocations': {
		'connections': 'workbench.view.explorer',
		'workbench.panel.positronConsole': 'workbench.panel.positronVariables'
	},
	'viewContainerBadgeEnablementStates': {}
};

export const sideBySideDS: IViewsCustomizations = {
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
};
