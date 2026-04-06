/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
/// <reference types="vitest/globals" />

import { URI } from '../../../../../base/common/uri.js';
import { createTestContainer } from '../../../../test/browser/positronTestContainer.js';
import { IQuartoDocumentModelService } from '../../browser/quartoDocumentModelService.js';
import { IQuartoOutputCacheService } from '../../common/quartoExecutionTypes.js';
import { QuartoKernelManager, QuartoKernelState } from '../../browser/quartoKernelManager.js';

describe('QuartoKernelManager', () => {
	const ctx = createTestContainer()
		.withWorkbenchServices()
		.stub(IQuartoDocumentModelService, {} as IQuartoDocumentModelService)
		.stub(IQuartoOutputCacheService, {} as IQuartoOutputCacheService)
		.build();

	let kernelManager: QuartoKernelManager;

	beforeEach(() => {
		kernelManager = ctx.disposables.add(
			ctx.instantiationService.createInstance(QuartoKernelManager)
		);
	});

	describe('getKernelState', () => {
		it('returns None for an unknown document', () => {
			const uri = URI.file('/unknown-document.qmd');
			expect(kernelManager.getKernelState(uri)).toBe(QuartoKernelState.None);
		});
	});

	describe('getSessionForDocument', () => {
		it('returns undefined for an unknown document', () => {
			const uri = URI.file('/unknown-document.qmd');
			expect(kernelManager.getSessionForDocument(uri)).toBeUndefined();
		});
	});

	describe('shutdownKernelForDocument', () => {
		it('is a no-op for an unknown document and does not throw', async () => {
			const uri = URI.file('/unknown-document.qmd');
			await expect(kernelManager.shutdownKernelForDocument(uri)).resolves.toBeUndefined();
		});
	});

	describe('interruptKernelForDocument', () => {
		it('is a no-op for an unknown document and does not throw', () => {
			const uri = URI.file('/unknown-document.qmd');
			expect(() => kernelManager.interruptKernelForDocument(uri)).not.toThrow();
		});
	});

	describe('onDidChangeKernelState', () => {
		it('is an event that can be subscribed to', () => {
			const listener = kernelManager.onDidChangeKernelState(() => { });
			ctx.disposables.add(listener);
			// If we got here without throwing, the event exists and is subscribable
		});
	});
});
