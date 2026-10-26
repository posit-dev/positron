/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IViewDescriptorService } from '../../../common/views.js';
import { IViewsService } from '../common/viewsService.js';

/**
 * Opens a view without taking keyboard focus, unless doing so would switch the
 * active tab in the part where the view lives (i.e. another view container is
 * showing there).
 */
export async function openViewPreservingActiveTab(
	viewId: string,
	viewsService: IViewsService,
	viewDescriptorService: IViewDescriptorService,
): Promise<void> {
	const viewContainer = viewDescriptorService.getViewContainerByViewId(viewId);
	const location = viewContainer && viewDescriptorService.getViewContainerLocation(viewContainer);
	if (viewContainer && location !== null) {
		// Hiding a part clears its active container, so a hidden part still opens.
		const visibleContainer = viewsService.getVisibleViewContainer(location);
		if (visibleContainer && visibleContainer.id !== viewContainer.id) {
			return;
		}
	}
	await viewsService.openView(viewId, false);
}
