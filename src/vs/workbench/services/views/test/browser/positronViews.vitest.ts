/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { IViewDescriptorService, ViewContainer, ViewContainerLocation } from '../../../../common/views.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IViewsService } from '../../common/viewsService.js';
import { openViewPreservingActiveTab } from '../../browser/positronViews.js';

describe('openViewPreservingActiveTab', () => {
	const viewContainer = stubInterface<ViewContainer>({ id: 'consoleContainer' });

	async function openWithVisibleContainer(visibleContainerId: string | undefined) {
		const openView = vi.fn(async () => null);
		const viewsService = stubInterface<IViewsService>({
			openView,
			getVisibleViewContainer: () => visibleContainerId === undefined ?
				null :
				stubInterface<ViewContainer>({ id: visibleContainerId }),
		});
		const viewDescriptorService = stubInterface<IViewDescriptorService>({
			getViewContainerByViewId: () => viewContainer,
			getViewContainerLocation: () => ViewContainerLocation.Panel,
		});

		await openViewPreservingActiveTab('consoleView', viewsService, viewDescriptorService);
		return openView;
	}

	it('leaves another visible container showing', async () => {
		expect(await openWithVisibleContainer('terminalContainer')).not.toHaveBeenCalled();
	});

	it('opens the view when its own container is visible', async () => {
		expect(await openWithVisibleContainer('consoleContainer')).toHaveBeenCalledWith('consoleView', false);
	});

	it('opens the view when nothing is showing in its part', async () => {
		expect(await openWithVisibleContainer(undefined)).toHaveBeenCalledWith('consoleView', false);
	});
});
