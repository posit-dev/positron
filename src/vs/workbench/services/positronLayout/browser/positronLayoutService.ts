/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IPositronLayoutService } from './interfaces/positronLayoutService.js';
import { CustomPositronLayoutDescription } from '../common/positronCustomViews.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { IWorkbenchLayoutService } from '../../layout/browser/layoutService.js';


class PositronLayoutService extends Disposable implements IPositronLayoutService {

	declare readonly _serviceBrand: undefined;

	initialize() {
		// no-op
	}

	constructor(
		@IWorkbenchLayoutService private readonly _workbenchLayoutService: IWorkbenchLayoutService,
		@IViewDescriptorService private readonly _viewDescriptorService: IViewDescriptorService,
	) {
		super();
	}

	setLayout(layout: CustomPositronLayoutDescription) {
		this._viewDescriptorService.loadCustomViewDescriptor(layout);
		// Run the layout service action after the view descriptor has been loaded.
		// This is needed so that the changing of the contents of the parts doesn't
		// break the currently open view container that is set by the layoutService.
		this._workbenchLayoutService.enterCustomLayout(layout);
	}
}

// Register the Positron layout service.
registerSingleton(IPositronLayoutService, PositronLayoutService, InstantiationType.Delayed);
