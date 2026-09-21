/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { PositronPreviewService } from '../../browser/positronPreviewServiceImpl.js';
import { IPositronPreviewService, PreviewOpenTarget } from '../../browser/positronPreviewSevice.js';

describe('Positron - Preview Service', () => {

	const ctx = createTestContainer().withWorkbenchServices().build();
	let previewService: IPositronPreviewService;
	let storageService: IStorageService;

	const STORAGE_KEY = 'positronPreview.defaultOpenTarget';

	beforeEach(() => {
		previewService = ctx.disposables.add(ctx.instantiationService.createInstance(PositronPreviewService));
		storageService = ctx.instantiationService.invokeFunction(accessor => accessor.get(IStorageService));
		storageService.remove(STORAGE_KEY, StorageScope.WORKSPACE);
	});

	it('getDefaultOpenTarget validates stored values and falls back when unrecognized', () => {
		storageService.store(STORAGE_KEY, 'someUnknownValue', StorageScope.WORKSPACE, StorageTarget.MACHINE);
		expect(previewService.getDefaultOpenTarget()).toBe(PreviewOpenTarget.Browser);
	});

	it('retains and navigates Viewer output history', () => {
		const historyState = () => ({
			previewIds: previewService.previewWebviews.map(preview => preview.previewId),
			activePreviewId: previewService.activePreviewWebviewId,
			canSelectPrevious: previewService.canSelectPreviousPreview,
			canSelectNext: previewService.canSelectNextPreview,
		});

		previewService.openHtmlString('first', '<p>First</p>', 'First');
		previewService.openHtmlString('second', '<p>Second</p>', 'Second');
		const newestState = historyState();

		previewService.selectPreviousPreview();
		const previousState = historyState();

		previewService.selectNextPreview();
		const nextState = historyState();

		previewService.clearAllPreviews();
		const clearedState = historyState();

		expect({
			newestState,
			previousState,
			nextState,
			clearedState,
		}).toEqual({
			newestState: {
				previewIds: ['first', 'second'],
				activePreviewId: 'second',
				canSelectPrevious: true,
				canSelectNext: false,
			},
			previousState: {
				previewIds: ['first', 'second'],
				activePreviewId: 'first',
				canSelectPrevious: false,
				canSelectNext: true,
			},
			nextState: {
				previewIds: ['first', 'second'],
				activePreviewId: 'second',
				canSelectPrevious: true,
				canSelectNext: false,
			},
			clearedState: {
				previewIds: [],
				activePreviewId: '',
				canSelectPrevious: false,
				canSelectNext: false,
			},
		});
	});
});
