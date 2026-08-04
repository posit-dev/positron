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
 * an untitled Quarto document was saved with Save As (71% on sles/chromium).
 *
 * On the untitled->saved transition the contribution rebinds the output cache
 * from the untitled URI to the saved document's URI. That rebind used to require
 * a `file` scheme, so in a remote or web window -- where a saved document is
 * `vscode-remote` -- it never ran and the cache stayed keyed to the untitled URI.
 * Output still rendered right after the save, because the content-hash fallback
 * matched the still-live untitled cache in memory, but nothing existed under the
 * saved URI to restore from once the window reloaded.
 *
 * These tests drive the real contribution across an `onDidChangeModel` from an
 * untitled model to a saved one, and assert which URI the cache was written to.
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

	/** URIs the contribution wrote cached output to, in call order. */
	let savedToUris: string[] = [];
	/** URIs whose cache the contribution cleared, in call order. */
	let clearedUris: string[] = [];

	const quartoModel = stubInterface<IQuartoDocumentModel>({
		get cells() { return liveCells; },
		onDidParse: Event.None,
		findCellByContentHash: (hash: string) => liveCells.find(c => c.contentHash === hash),
		getCellById: (id: string) => liveCells.find(c => c.id === id),
	});

	const ctx = createTestContainer()
		.withWorkbenchServices()
		.withContributionServices()
		.stub(IQuartoDocumentModelService, { getModel: () => quartoModel })
		.stub(IQuartoOutputCacheService, {
			loadCache: async () => undefined,
			findCacheByContentHash: async () => undefined,
			getCachedOutputs: (uri: URI) => uri.toString() === untitledUri.toString() ? untitledCache : new Map(),
			saveOutput: (uri: URI) => { savedToUris.push(uri.toString()); },
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
		savedToUris = [];
		clearedUris = [];
		currentModel = undefined;
	});

	/** A parsed cell for the one-line code range the text models below carry. */
	function cell(): QuartoCodeCell {
		return stubInterface<QuartoCodeCell>({
			id: cellId,
			contentHash,
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
	 * model change that a Save As produces, landing on `savedUri`.
	 */
	function saveAsTo(savedUri: URI): void {
		modelFor(untitledUri);
		const editor = stubInterface<ICodeEditor>({
			hasModel: (() => true) as ICodeEditor['hasModel'],
			getModel: () => currentModel ?? null,
			getOption: (() => false) as ICodeEditor['getOption'],
			onDidChangeModel: modelChangeEmitter.event,
			onDidScrollChange: Event.None,
		});
		QUARTO_INLINE_OUTPUT_ENABLED.bindTo(ctx.get(IContextKeyService)).set(true);
		ctx.disposables.add(ctx.instantiationService.createInstance(QuartoOutputContribution, editor));

		// The save swaps the editor's model for the saved document, which the
		// document model reports as parsed by the time the change is handled.
		modelFor(savedUri);
		liveCells = [cell()];
		modelChangeEmitter.fire({ oldModelUrl: untitledUri, newModelUrl: savedUri });
	}

	it('rebinds the cache to a vscode-remote document saved from untitled', () => {
		const savedUri = URI.from({ scheme: 'vscode-remote', authority: 'localhost:9000', path: '/w/saved.qmd' });

		saveAsTo(savedUri);

		// With the bug the rebind was skipped for any non-file scheme, so the
		// cache stayed under the untitled URI and the reload had nothing to load.
		expect({ savedToUris, clearedUris }).toEqual({
			savedToUris: [savedUri.toString()],
			clearedUris: [untitledUri.toString()],
		});
	});

	it('rebinds the cache to a file document saved from untitled', () => {
		const savedUri = URI.file('/w/saved.qmd');

		saveAsTo(savedUri);

		expect({ savedToUris, clearedUris }).toEqual({
			savedToUris: [savedUri.toString()],
			clearedUris: [untitledUri.toString()],
		});
	});

	it('does not rebind when an untitled document is swapped for another untitled one', () => {
		saveAsTo(URI.from({ scheme: 'untitled', path: '/Untitled-2.qmd' }));

		expect({ savedToUris, clearedUris }).toEqual({ savedToUris: [], clearedUris: [] });
	});
});
