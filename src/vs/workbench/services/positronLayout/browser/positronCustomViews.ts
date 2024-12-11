/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import { IQuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';
import { CustomPositronLayoutDescription } from '../common/positronCustomViews.js';
import { positronFourPaneDsLayout } from './layouts/positronFourPaneDsLayout.js';
import { positronTwoPaneLayout } from './layouts/positronTwoPaneLayout.js';
import { positronNotebookLayout } from './layouts/positronNotebookLayout.js';
import { PositronLayoutInfo } from './layouts/layoutAction.js';

// Imports needed to register the layout service and non-primary layouts. (Otherwise the scripts
// are not run and the commands are not registered.)
import './positronLayoutService.js';
import './layouts/maximizedPartLayouts.js';
import './layouts/positronHelpPaneDocked.js';


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

