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
 * inline output silently fails to re-render.
 *
 * `_loadCachedOutputs` matches cached outputs to live cells by content hash, so
 * a restore that ran before the parse matched nothing and marked itself
 * complete, dropping every cached output. It now waits on the model's parse
 * state, which separates "not parsed yet" from "parsed, and this document has
 * no cells".
 *
 * `getCellById` returns undefined throughout, so the restore records outputs
 * via `getOutputsForCell` without building a view zone: the wait decision is
 * under test, not the render layer.
 */
describe('QuartoOutputContribution -- cached output restore on reopen', () => {
	const cachedCellId = '0-abchash-unlabeled';
	const contentHash = 'abchash';

	// Describe-scope so the container's stubs capture stable references at
	// build() time; reset per test (see beforeEach) for isolation.
	const parseEmitter = new Emitter<void>();
	let liveCells: QuartoCodeCell[] = [];
	let isParsed = false;
	let cachedDoc: ICachedDocument | undefined;
	let hashMatchedDoc: ICachedDocument | undefined;

	// Spied so the fallback's arguments can be asserted: it keys off the model's
	// cells, so the hashes it receives show whether it ran before or after the parse.
	const findCacheByContentHash = vi.fn(async (_targetUri: URI, _contentHashes: string[]) => hashMatchedDoc);

	const quartoModel = stubInterface<IQuartoDocumentModel>({
		get cells() { return liveCells; },
		get isParsed() { return isParsed; },
		whenParsed: async () => {
			if (!isParsed) {
				await Event.toPromise(parseEmitter.event);
			}
		},
		onDidParse: parseEmitter.event,
		findCellByContentHash: (hash: string) => liveCells.find(c => c.contentHash === hash),
		getCellById: () => undefined,
	});

	const ctx = createTestContainer()
		.withContributionServices()
		.stub(IQuartoDocumentModelService, { getModel: () => quartoModel })
		.stub(IQuartoOutputCacheService, {
			loadCache: async () => cachedDoc,
			findCacheByContentHash,
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
		isParsed = false;
		cachedDoc = undefined;
		hashMatchedDoc = undefined;
	});

	/** Mirror a parse landing on the model: cells appear and `isParsed` flips. */
	function parse(cells: QuartoCodeCell[]): void {
		liveCells = cells;
		isParsed = true;
		parseEmitter.fire();
	}

	/** The parsed cell the cached output belongs to. */
	function cell(): QuartoCodeCell {
		return stubInterface<QuartoCodeCell>({ id: cachedCellId, contentHash });
	}

	/** A cache entry with one text/plain output for that cell. */
	function cacheWith(): ICachedDocument {
		return {
			sourceUri: 'file:///reopen.qmd',
			lastUpdated: Date.now(),
			cells: [{ cellId: cachedCellId, contentHash, outputs: [{ outputId: 'out-1', items: [{ mime: 'text/plain', data: 'plot' }] }] }],
		};
	}

	/** Instantiate the contribution over a fresh editor for the document. */
	function reopen(): QuartoOutputContribution {
		const uri = URI.file('/reopen.qmd');
		const editorModel = ctx.disposables.add(createTextModel('', 'quarto', undefined, uri));
		const editor = stubInterface<ICodeEditor>({
			hasModel: (() => true) as ICodeEditor['hasModel'],
			getModel: () => editorModel,
			getOption: (() => false) as ICodeEditor['getOption'],
			onDidChangeModel: Event.None,
			onDidScrollChange: Event.None,
		});
		QUARTO_INLINE_OUTPUT_ENABLED.bindTo(ctx.get(IContextKeyService)).set(true);
		return ctx.disposables.add(ctx.instantiationService.createInstance(QuartoOutputContribution, editor));
	}

	/** Flush the async restore (loadCache and the parse wait are microtask-scheduled). */
	const settle = () => new Promise(resolve => setTimeout(resolve, 0));

	it('restores cached output once the model parses', async () => {
		cachedDoc = cacheWith();
		isParsed = false; // opened before the parse landed

		const contribution = reopen();
		await settle();
		// Nothing can match before parse, so the output is not restored yet. This
		// is a weak guard: it also holds if the restore simply hasn't run, since
		// the contribution exposes no "awaiting parse" state to assert on. The
		// post-parse assertion below is what carries the signal.
		expect(contribution.getOutputsForCell(cachedCellId)).toHaveLength(0);

		// The model parses and the cached cell appears (mirrors onDidParse on reopen).
		parse([cell()]);
		await settle();
		// With the bug the reopen fell through, dropped the output, and never
		// retried, so this stayed empty.
		expect(contribution.getOutputsForCell(cachedCellId)).toHaveLength(1);
	});

	// The wait has to come before the content-hash fallback, not after it: the
	// fallback searches on the model's cells, so running it pre-parse searches
	// an empty list and finds nothing to restore.
	it('runs the content-hash fallback with the parsed cells', async () => {
		cachedDoc = undefined;			// nothing cached under this URI
		hashMatchedDoc = cacheWith();	// but the cell's content is cached elsewhere
		isParsed = false;

		const contribution = reopen();
		await settle();
		expect(findCacheByContentHash).not.toHaveBeenCalled();

		parse([cell()]);
		await settle();
		expect(findCacheByContentHash).toHaveBeenCalledWith(expect.anything(), [contentHash]);
		expect(contribution.getOutputsForCell(cachedCellId)).toHaveLength(1);
	});

	// A parsed document that reports no cells is authoritative, so the restore
	// completes rather than waiting for a parse that will never add cells.
	it('completes the restore for a parsed document with no cells', async () => {
		cachedDoc = cacheWith();
		liveCells = [];
		isParsed = true;

		const contribution = reopen();
		await settle();
		expect(contribution.getOutputsForCell(cachedCellId)).toHaveLength(0);

		// A later parse must not re-run the restore: the load already completed.
		parse([cell()]);
		await settle();
		expect(contribution.getOutputsForCell(cachedCellId)).toHaveLength(0);
	});
});
