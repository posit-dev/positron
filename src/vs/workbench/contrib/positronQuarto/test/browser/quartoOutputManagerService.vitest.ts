/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Emitter, Event } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { CellExecutionState, ExecutionOutputEvent, ICellOutput, IQuartoExecutionManager, IQuartoOutputCacheService } from '../../common/quartoExecutionTypes.js';
import { QuartoCodeCell } from '../../common/quartoTypes.js';
import { QuartoOutputManagerService } from '../../browser/quartoOutputManager.js';

// Must match the non-exported constant in quartoOutputManager.ts. If the key
// is renamed, that is a migration concern and this test should fail to flag it.
const STORAGE_KEY = 'positron.quarto.collapsedCells';

describe('QuartoOutputManagerService', () => {
	const onDidReceiveOutput = new Emitter<ExecutionOutputEvent>();
	let executionState = CellExecutionState.Idle;
	let cachedOutputs = new Map<string, ICellOutput[]>();

	const ctx = createTestContainer()
		.withWorkbenchServices()
		.stub(IQuartoExecutionManager, {
			onDidReceiveOutput: onDidReceiveOutput.event,
			onDidChangeExecutionState: Event.None,
			getExecutionState: () => executionState,
		})
		.stub(IQuartoOutputCacheService, {
			clearCache: vi.fn(),
			runCleanup: () => Promise.resolve(),
			getCachedOutputs: () => cachedOutputs,
		})
		.build();

	beforeEach(() => {
		executionState = CellExecutionState.Idle;
		cachedOutputs = new Map();
	});

	function createService(): QuartoOutputManagerService {
		const service = ctx.instantiationService.createInstance(QuartoOutputManagerService);
		ctx.disposables.add(service);
		return service;
	}

	function seedStorage(payload: Record<string, string[]>): void {
		const storage = ctx.get(IStorageService);
		storage.store(STORAGE_KEY, JSON.stringify(payload), StorageScope.WORKSPACE, StorageTarget.MACHINE);
	}

	function readStorage(): string | undefined {
		return ctx.get(IStorageService).get(STORAGE_KEY, StorageScope.WORKSPACE);
	}

	const uriA = URI.file('/docs/a.qmd');
	const uriB = URI.file('/docs/b.qmd');

	describe('clearAllOutputs(documentUri)', () => {
		it('removes only the given URI from the persisted collapsed-cell map', () => {
			seedStorage({
				[uriA.toString()]: ['cell1', 'cell2'],
				[uriB.toString()]: ['cell3'],
			});

			createService().clearAllOutputs(uriA);

			const remaining = JSON.parse(readStorage()!);
			expect(remaining).toEqual({ [uriB.toString()]: ['cell3'] });
		});

		it('removes the storage key entirely when clearing the last remaining URI', () => {
			seedStorage({ [uriA.toString()]: ['cell1'] });

			createService().clearAllOutputs(uriA);

			expect(readStorage()).toBeUndefined();
		});

		it('is a no-op when no collapsed-cell state is saved', () => {
			expect(() => createService().clearAllOutputs(uriA)).not.toThrow();
			expect(readStorage()).toBeUndefined();
		});

		it('is a no-op when the URI has no entry in the saved map', () => {
			seedStorage({ [uriB.toString()]: ['cell3'] });

			createService().clearAllOutputs(uriA);

			const remaining = JSON.parse(readStorage()!);
			expect(remaining).toEqual({ [uriB.toString()]: ['cell3'] });
		});

		it('swallows malformed JSON and logs a warning', () => {
			const storage = ctx.get(IStorageService);
			storage.store(STORAGE_KEY, '{not valid json', StorageScope.WORKSPACE, StorageTarget.MACHINE);
			const warn = vi.spyOn(ctx.get(ILogService), 'warn');

			expect(() => createService().clearAllOutputs(uriA)).not.toThrow();
			expect(warn).toHaveBeenCalled();
		});

		it('silently no-ops when stored JSON is not an object (e.g. null)', () => {
			const storage = ctx.get(IStorageService);
			storage.store(STORAGE_KEY, 'null', StorageScope.WORKSPACE, StorageTarget.MACHINE);
			const warn = vi.spyOn(ctx.get(ILogService), 'warn');

			expect(() => createService().clearAllOutputs(uriA)).not.toThrow();
			expect(warn).not.toHaveBeenCalled();
			expect(readStorage()).toBe('null');
		});

		it('wipes storage before firing onDidRequestClearDocument with the cleared URI', () => {
			seedStorage({
				[uriA.toString()]: ['cell1'],
				[uriB.toString()]: ['cell3'],
			});
			const service = createService();

			let handlerFired = false;
			let storageAtFireTime: string | undefined;
			let firedUri: URI | undefined;
			ctx.disposables.add(service.onDidRequestClearDocument(uri => {
				handlerFired = true;
				firedUri = uri;
				storageAtFireTime = readStorage();
			}));

			service.clearAllOutputs(uriA);

			expect(handlerFired).toBe(true);
			expect(firedUri?.toString()).toBe(uriA.toString());
			expect(JSON.parse(storageAtFireTime!)).toEqual({ [uriB.toString()]: ['cell3'] });
		});
	});

	describe('getOutputsForCell()', () => {
		const output: ICellOutput = { outputId: 'o1', items: [{ mime: 'text/plain', data: '2' }] };
		const cell = (id: string): QuartoCodeCell => ({
			id, language: 'r', startLine: 1, endLine: 3, codeStartLine: 2, codeEndLine: 2,
			options: '', contentHash: 'abcd1234abcd1234', index: 0,
		});

		it('returns the outputs of a cell run in this window, scoped to its document', () => {
			const service = createService();
			executionState = CellExecutionState.Completed;
			onDidReceiveOutput.fire({ cellId: '0-abcd1234-unlabeled', output, documentUri: uriA });

			expect(service.getOutputsForCell(uriA, cell('0-abcd1234-unlabeled'))).toEqual([output]);
			expect(service.getOutputsForCell(uriB, cell('0-abcd1234-unlabeled'))).toEqual([]);
		});

		it('falls back to cached outputs matched by content hash for a cell that has not run', () => {
			cachedOutputs = new Map([['0-abcd1234-unlabeled', [output]]]);

			expect(createService().getOutputsForCell(uriA, cell('2-abcd1234-unlabeled'))).toEqual([output]);
		});
	});

	describe('clearAllOutputsGlobally()', () => {
		it('removes the collapsed-cell storage key entirely', () => {
			seedStorage({
				[uriA.toString()]: ['cell1'],
				[uriB.toString()]: ['cell3'],
			});

			createService().clearAllOutputsGlobally();

			expect(readStorage()).toBeUndefined();
		});

		it('wipes storage before firing onDidRequestClearAll', () => {
			seedStorage({ [uriA.toString()]: ['cell1'] });
			const service = createService();

			let handlerFired = false;
			let storageAtFireTime: string | undefined;
			ctx.disposables.add(service.onDidRequestClearAll(() => {
				handlerFired = true;
				storageAtFireTime = readStorage();
			}));

			service.clearAllOutputsGlobally();

			expect(handlerFired).toBe(true);
			expect(storageAtFireTime).toBeUndefined();
		});
	});
});
