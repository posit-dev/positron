/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/
import { IQuickPickItem } from 'vs/platform/quickinput/common/quickInput';
import { CustomPositronLayoutDescription } from 'vs/workbench/services/positronLayout/common/positronCustomViews';
import { positronFourPaneDsLayout } from './layouts/positronFourPaneDsLayout';
import { positronTwoPaneLayout } from './layouts/positronTwoPaneLayout';
import { positronNotebookLayout } from './layouts/positronNotebookLayout';
import { PositronLayoutInfo } from './layouts/layoutAction';

// Imports needed to register the layout service and non-primary layouts. (Otherwise the scripts
// are not run and the commands are not registered.)
import 'vs/workbench/services/positronLayout/browser/positronLayoutService';
import './layouts/maximizedPartLayouts';
import './layouts/positronHelpPaneDocked';


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

