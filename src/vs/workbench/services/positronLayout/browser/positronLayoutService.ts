/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { IPositronLayoutService } from './interfaces/positronLayoutService';
import { CustomPositronLayoutDescription } from 'vs/workbench/services/positronLayout/common/positronCustomViews';
import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IViewDescriptorService } from 'vs/workbench/common/views';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';


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
