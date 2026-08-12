/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { URI } from '../../../../../base/common/uri.js';
import { Event, Emitter } from '../../../../../base/common/event.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { createTextModel } from '../../../../../editor/test/common/testTextModel.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ICodeEditor } from '../../../../../editor/browser/editorBrowser.js';
import { ITextModel } from '../../../../../editor/common/model.js';
import { IModelChangedEvent } from '../../../../../editor/common/editorCommon.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { QuartoOutputContribution, IQuartoOutputManager } from '../../browser/quartoOutputManager.js';
import { IQuartoDocumentModelService } from '../../browser/quartoDocumentModelService.js';
import { IQuartoKernelManager } from '../../browser/quartoKernelManager.js';
import { IQuartoExecutionManager, IQuartoOutputCacheService, ICellOutput } from '../../common/quartoExecutionTypes.js';
import { IQuartoDocumentModel, QuartoCodeCell } from '../../common/quartoTypes.js';
import { QUARTO_INLINE_OUTPUT_ENABLED } from '../../common/positronQuartoConfig.js';
import { IPositronNotebookOutputWebviewService } from '../../../positronOutputWebview/browser/notebookOutputWebviewService.js';
import { IResourceUsageHistoryService } from '../../../../services/positronConsole/browser/resourceUsageHistoryService.js';

/**
 * Regression coverage for inline output disappearing after a window reload when
 * an untitled Quarto document was saved with Save As.
 *
 * On the untitled->saved transition the contribution rebinds the output cache to
 * the saved document's URI. The rebind used to require a `file` scheme, so a
 * remote or web save (`vscode-remote`) left the cache keyed to the untitled URI
 * with nothing for the reload to restore from.
 */
describe('QuartoOutputContribution -- cache rebind on Save As', () => {
	const cellId = '0-abchash-unlabeled';
	const contentHash = 'abchash';
	const untitledUri = URI.from({ scheme: 'untitled', path: '/Untitled-1.qmd' });
	const output: ICellOutput = { outputId: 'out-1', items: [{ mime: 'text/plain', data: 'plot' }] };

	// Describe-scope so the container's stubs capture stable references at
	// build() time; reset per test (see beforeEach) for isolation.
	const modelChangeEmitter = new Emitter<IModelChangedEvent>();
	let liveCells: QuartoCodeCell[] = [];
	let untitledCache = new Map<string, ICellOutput[]>();
	let currentModel: ITextModel | undefined;

	/** Cache writes the contribution made, in call order. */
	let cacheWrites: { uri: string; cellId: string; contentHash: string }[] = [];
	/** URIs whose cache the contribution cleared, in call order. */
	let clearedUris: string[] = [];

	const quartoModel = stubInterface<IQuartoDocumentModel>({
		get cells() { return liveCells; },
		onDidParse: Event.None,
		getCellById: (id: string) => liveCells.find(c => c.id === id),
	});

	const ctx = createTestContainer()
		.withContributionServices()
		.stub(IQuartoDocumentModelService, { getModel: () => quartoModel })
		.stub(IQuartoOutputCacheService, {
			// No cache exists under the saved URI until the rebind writes one.
			// These two are read inside the restore pass's try/catch, so leaving
			// them unstubbed would abort that pass silently rather than loudly.
			loadCache: async () => undefined,
			findCacheByContentHash: async () => undefined,
			getCachedOutputs: (uri: URI) => uri.toString() === untitledUri.toString() ? untitledCache : new Map(),
			// A reload restores by cell id and hash, so record those alongside the
			// URI -- a write under the pre-save id is as lost as no write at all.
			saveOutput: (uri: URI, cellId: string, contentHash: string) => {
				cacheWrites.push({ uri: uri.toString(), cellId, contentHash });
			},
			clearCache: (uri: URI) => { clearedUris.push(uri.toString()); },
		})
		.stub(IQuartoExecutionManager, {
			onDidReceiveOutput: Event.None,
			onDidChangeExecutionState: Event.None,
			onWillExecute: Event.None,
		})
		.stub(IQuartoKernelManager, {
			onDidChangeKernelState: Event.None,
			getSessionForDocument: () => undefined,
		})
		.stub(IQuartoOutputManager, {
			onDidChangeOutputs: Event.None,
			onDidRequestClearDocument: Event.None,
			onDidRequestClearAll: Event.None,
		})
		.stub(IPositronNotebookOutputWebviewService, {})
		.stub(IResourceUsageHistoryService, {})
		.build();

	beforeEach(() => {
		liveCells = [];
		untitledCache = new Map([[cellId, [output]]]);
		cacheWrites = [];
		clearedUris = [];
		currentModel = undefined;
	});

	/** A parsed cell for the one-line code range the text models below carry. */
	function cell(overrides: { id?: string; contentHash?: string } = {}): QuartoCodeCell {
		return stubInterface<QuartoCodeCell>({
			id: overrides.id ?? cellId,
			contentHash: overrides.contentHash ?? contentHash,
			label: undefined,
			codeStartLine: 1,
			codeEndLine: 1,
		});
	}

	/** Swap in a text model for the given URI; returns it for the editor stub. */
	function modelFor(uri: URI): ITextModel {
		currentModel = ctx.disposables.add(createTextModel('print("hi")', 'quarto', undefined, uri));
		return currentModel;
	}

	/**
	 * Instantiate the contribution over an untitled document, then fire the
	 * model change that a Save As produces, landing on `savedUri`. The saved
	 * document parses as `savedCells`, which defaults to the cached cell.
	 */
	function saveAsTo(savedUri: URI, savedCells: QuartoCodeCell[] = [cell()]): QuartoOutputContribution {
		modelFor(untitledUri);
		const editor = stubInterface<ICodeEditor>({
			hasModel: (() => true) as ICodeEditor['hasModel'],
			getModel: () => currentModel ?? null,
			getOption: (() => false) as ICodeEditor['getOption'],
			onDidChangeModel: modelChangeEmitter.event,
			onDidScrollChange: Event.None,
		});
		QUARTO_INLINE_OUTPUT_ENABLED.bindTo(ctx.get(IContextKeyService)).set(true);
		const contribution = ctx.disposables.add(ctx.instantiationService.createInstance(QuartoOutputContribution, editor));

		// The save swaps the editor's model for the saved document, which the
		// document model reports as parsed by the time the change is handled.
		modelFor(savedUri);
		liveCells = savedCells;
		modelChangeEmitter.fire({ oldModelUrl: untitledUri, newModelUrl: savedUri });
		return contribution;
	}

	// The rebind is scheme-independent: with the bug it was skipped for any
	// non-file scheme, so the cache stayed under the untitled URI and the reload
	// had nothing to load. The in-memory outputs keep the output on screen
	// across the save either way.
	it.each([
		['vscode-remote', URI.from({ scheme: 'vscode-remote', authority: 'localhost:9000', path: '/w/saved.qmd' })],
		['file', URI.file('/w/saved.qmd')],
	])('rebinds the cache to a %s document saved from untitled', (_scheme, savedUri) => {
		const contribution = saveAsTo(savedUri);

		expect({
			cacheWrites,
			clearedUris,
			outputs: contribution.getOutputsForCell(cellId),
		}).toEqual({
			cacheWrites: [{ uri: savedUri.toString(), cellId, contentHash }],
			clearedUris: [untitledUri.toString()],
			outputs: [output],
		});
	});

	it('rebinds to a cell whose index shifted, matching on the content hash prefix', () => {
		// The cached id encodes the cell's index (`0-abchash-unlabeled`), so an
		// edit above the cell changes its id. The rebind falls back to matching
		// the hash prefix, and the outputs must follow the cell's new id.
		const savedUri = URI.file('/w/saved.qmd');
		const shifted = cell({ id: '1-abchash-unlabeled', contentHash: `${contentHash}9f` });

		const contribution = saveAsTo(savedUri, [shifted]);

		expect({
			cacheWrites,
			outputsUnderNewId: contribution.getOutputsForCell(shifted.id),
			outputsUnderCachedId: contribution.getOutputsForCell(cellId),
		}).toEqual({
			// Written under the cell's new id, not the cached one it matched by.
			cacheWrites: [{ uri: savedUri.toString(), cellId: shifted.id, contentHash: shifted.contentHash }],
			outputsUnderNewId: [output],
			outputsUnderCachedId: [],
		});
	});

	it('writes nothing for a cached cell that matches no cell in the saved document', () => {
		const savedUri = URI.file('/w/saved.qmd');
		const unrelated = cell({ id: '0-zzzhash-unlabeled', contentHash: 'zzzhash' });

		const contribution = saveAsTo(savedUri, [unrelated]);

		// Nothing transfers, and the untitled cache is cleared regardless, so a
		// cell edited during the save loses its output. Asserting the clear pins
		// today's behavior rather than endorsing it.
		expect({
			cacheWrites,
			clearedUris,
			outputs: contribution.getOutputsForCell(unrelated.id),
		}).toEqual({
			cacheWrites: [],
			clearedUris: [untitledUri.toString()],
			outputs: [],
		});
	});

	it('does not rebind when an untitled document is swapped for another untitled one', () => {
		saveAsTo(URI.from({ scheme: 'untitled', path: '/Untitled-2.qmd' }));

		expect({ cacheWrites, clearedUris }).toEqual({ cacheWrites: [], clearedUris: [] });
	});
});
