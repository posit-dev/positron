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
});
