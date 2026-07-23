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
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { QuartoOutputContribution, IQuartoOutputManager } from '../../browser/quartoOutputManager.js';
import { IQuartoDocumentModelService } from '../../browser/quartoDocumentModelService.js';
import { IQuartoKernelManager } from '../../browser/quartoKernelManager.js';
import { IQuartoExecutionManager, IQuartoOutputCacheService, ICachedDocument } from '../../common/quartoExecutionTypes.js';
import { IQuartoDocumentModel, QuartoCodeCell } from '../../common/quartoTypes.js';
import { QUARTO_INLINE_OUTPUT_ENABLED } from '../../common/positronQuartoConfig.js';
import { IPositronNotebookOutputWebviewService } from '../../../positronOutputWebview/browser/notebookOutputWebviewService.js';
import { IResourceUsageHistoryService } from '../../../../services/positronConsole/browser/resourceUsageHistoryService.js';

/**
 * Regression coverage for the close-and-reopen flake where a Quarto .qmd's
 * inline output silently fails to re-render (win/electron, 120s timeout).
 *
 * On reopen the editor's text model exists before its cells are parsed.
 * `_loadCachedOutputs` matches cached outputs to live cells by content hash, so
 * with zero parsed cells nothing matches and the pass marks itself complete and
 * drops every cached output with no retry. The fix defers the restore until the
 * model has parsed cells, for any document scheme -- previously the deferral
 * only covered untitled hot-exit restores, so a file reopen fell through.
 *
 * These tests drive the real contribution: the document model's parse state is
 * controlled directly (it starts with no cells and gains one when the test
 * fires `onDidParse`), and `getCellById` returns undefined so the restore
 * records the output via `getOutputsForCell` without building a view zone --
 * the defer/retry decision is what is under test, not the render layer.
 */
describe('QuartoOutputContribution -- cached output restore on reopen', () => {
	const cachedCellId = '0-abchash-unlabeled';
	const contentHash = 'abchash';

	// Describe-scope so the container's stubs capture stable references at
	// build() time; reset per test (see beforeEach) for isolation.
	const parseEmitter = new Emitter<void>();
	let liveCells: QuartoCodeCell[] = [];
	let cachedDoc: ICachedDocument | undefined;

	const quartoModel = stubInterface<IQuartoDocumentModel>({
		get cells() { return liveCells; },
		onDidParse: parseEmitter.event,
		findCellByContentHash: (hash: string) => liveCells.find(c => c.contentHash === hash),
		getCellById: () => undefined,
	});

	const ctx = createTestContainer()
		.withWorkbenchServices()
		.withContributionServices()
		.stub(IQuartoDocumentModelService, { getModel: () => quartoModel })
		.stub(IQuartoOutputCacheService, {
			loadCache: async () => cachedDoc,
			findCacheByContentHash: async () => undefined,
		})
		.stub(IQuartoExecutionManager, {
			onDidReceiveOutput: Event.None,
			onDidChangeExecutionState: Event.None,
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
		cachedDoc = undefined;
	});

	/** A parsed cell carrying the given content hash (id is stable across tests). */
	function cell(hash = contentHash): QuartoCodeCell {
		return stubInterface<QuartoCodeCell>({ id: cachedCellId, contentHash: hash });
	}

	/** A cache entry with one text/plain output for a cell of the given hash. */
	function cacheWith(hash = contentHash): ICachedDocument {
		return {
			sourceUri: 'file:///reopen.qmd',
			lastUpdated: Date.now(),
			cells: [{ cellId: cachedCellId, contentHash: hash, outputs: [{ outputId: 'out-1', items: [{ mime: 'text/plain', data: 'plot' }] }] }],
		};
	}

	/** Instantiate the contribution over a fresh editor for the given document. */
	function reopen(uri = URI.file('/reopen.qmd')): QuartoOutputContribution {
		const editorModel = ctx.disposables.add(createTextModel('', 'quarto', undefined, uri));
		const editor = stubInterface<ICodeEditor>({
			hasModel: (() => true) as ICodeEditor['hasModel'],
			getModel: () => editorModel,
			getOption: (() => false) as ICodeEditor['getOption'],
			onDidChangeModel: Event.None,
		});
		QUARTO_INLINE_OUTPUT_ENABLED.bindTo(ctx.get(IContextKeyService)).set(true);
		return ctx.disposables.add(ctx.instantiationService.createInstance(QuartoOutputContribution, editor));
	}

	/** Flush the async restore (loadCache + retry are microtask-scheduled). */
	const settle = () => new Promise(resolve => setTimeout(resolve, 0));

	it('restores cached output after the model parses on reopen, instead of dropping it', async () => {
		cachedDoc = cacheWith();
		liveCells = []; // reopen before parse

		const contribution = reopen();
		await settle();
		// Nothing can match before parse, so the output is not restored yet.
		expect(contribution.getOutputsForCell(cachedCellId)).toHaveLength(0);

		// The model parses and the cached cell appears (mirrors onDidParse on reopen).
		liveCells = [cell()];
		parseEmitter.fire();
		await settle();
		// With the bug the reopen fell through, dropped the output, and never
		// retried, so this stayed empty.
		expect(contribution.getOutputsForCell(cachedCellId)).toHaveLength(1);
	});

	it('restores immediately when the model is already parsed at reopen', async () => {
		cachedDoc = cacheWith();
		liveCells = [cell()]; // already parsed; no deferral needed

		const contribution = reopen();
		await settle();
		expect(contribution.getOutputsForCell(cachedCellId)).toHaveLength(1);
	});

	it('drops a stale cached output whose content hash no longer matches after parse', async () => {
		cachedDoc = cacheWith('oldhash');
		liveCells = [];

		const contribution = reopen();
		await settle();

		// The cell parses with different content -> hash mismatch -> stale output not restored.
		liveCells = [cell('newhash')];
		parseEmitter.fire();
		await settle();
		expect(contribution.getOutputsForCell(cachedCellId)).toHaveLength(0);
	});

	it('still defers and restores for an untitled document reopened before parse', async () => {
		cachedDoc = cacheWith();
		liveCells = [];

		const contribution = reopen(URI.from({ scheme: 'untitled', path: '/Untitled-1.qmd' }));
		await settle();
		expect(contribution.getOutputsForCell(cachedCellId)).toHaveLength(0);

		liveCells = [cell()];
		parseEmitter.fire();
		await settle();
		expect(contribution.getOutputsForCell(cachedCellId)).toHaveLength(1);
	});
});
