/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize2 } from '../../../../../nls.js';
import { registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { Parts } from '../../../layout/browser/layoutService.js';
import { PositronLayoutAction } from './layoutAction.js';
import { KnownPositronLayoutParts, CustomPositronLayoutDescription } from '../../common/positronCustomViews.js';

// Layouts that maximize a single part as much as possible.
function makeMaximizedPartLayout(part: KnownPositronLayoutParts): CustomPositronLayoutDescription {
	return {
		[Parts.PANEL_PART]: { hidden: true },
		[Parts.SIDEBAR_PART]: { hidden: true },
		[Parts.AUXILIARYBAR_PART]: { hidden: true },
		[part]: { hidden: false, size: '100%' },
	};
}

registerAction2(class extends PositronLayoutAction {
	constructor() {
		super({
			id: 'workbench.action.fullSizedSidebar',
			label: localize2('chooseLayout.fullSizedSidebarLayout', 'Maximized Sidebar Layout'),
			hideFromPalette: false,
			layoutDescriptor: makeMaximizedPartLayout(Parts.SIDEBAR_PART),
		});
	}
});

registerAction2(class extends PositronLayoutAction {
	constructor() {
		super({
			id: 'workbench.action.fullSizedPanel',
			label: localize2('chooseLayout.fullSizedPanelLayout', 'Maximized Panel Layout'),
			hideFromPalette: false,
			layoutDescriptor: makeMaximizedPartLayout(Parts.PANEL_PART),
		});
	}
});

registerAction2(class extends PositronLayoutAction {
	constructor() {
		super({
			id: 'workbench.action.fullSizedAuxiliaryBar',
			label: localize2('chooseLayout.fullSizedAuxiliaryBarLayout', 'Maximized Auxiliary Bar Layout'),
			hideFromPalette: false,
			layoutDescriptor: makeMaximizedPartLayout(Parts.AUXILIARYBAR_PART),
		});
	}
});
