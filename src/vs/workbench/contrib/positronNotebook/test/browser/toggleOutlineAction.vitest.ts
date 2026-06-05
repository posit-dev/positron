/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ToggleOutlineAction } from '../../browser/positronNotebook.contribution.js';
import { IOutlinePane } from '../../../outline/browser/outline.js';
import { IViewsService } from '../../../../services/views/common/viewsService.js';

describe('ToggleOutlineAction', () => {
	const ctx = createTestContainer()
		.withWorkbenchServices()
		.build();

	let isViewVisible: ReturnType<typeof vi.fn<IViewsService['isViewVisible']>>;
	// openView is generic (<T extends IView>); store it with a wider mock signature and
	// re-narrow inside the stub via a closure so stubInterface's Partial<IViewsService>
	// stays type-correct.
	let openView: ReturnType<typeof vi.fn<(id: string, focus?: boolean) => Promise<unknown>>>;
	let closeView: ReturnType<typeof vi.fn<IViewsService['closeView']>>;

	beforeEach(() => {
		isViewVisible = vi.fn();
		openView = vi.fn<(id: string, focus?: boolean) => Promise<unknown>>().mockResolvedValue(null);
		closeView = vi.fn();
		ctx.instantiationService.stub(IViewsService, stubInterface<IViewsService>({
			isViewVisible,
			openView: <T>(id: string, focus?: boolean) => openView(id, focus) as Promise<T | null>,
			closeView,
		}));
	});

	async function run(): Promise<void> {
		const action = new ToggleOutlineAction();
		await ctx.instantiationService.invokeFunction(accessor => action.run(accessor));
	}

	it('opens and focuses the outline view when it is not visible', async () => {
		isViewVisible.mockReturnValue(false);

		await run();

		expect(openView).toHaveBeenCalledWith(IOutlinePane.Id, true);
		expect(closeView).not.toHaveBeenCalled();
	});

	it('closes the outline view when it is visible', async () => {
		isViewVisible.mockReturnValue(true);

		await run();

		expect(closeView).toHaveBeenCalledWith(IOutlinePane.Id);
		expect(openView).not.toHaveBeenCalled();
	});
});
