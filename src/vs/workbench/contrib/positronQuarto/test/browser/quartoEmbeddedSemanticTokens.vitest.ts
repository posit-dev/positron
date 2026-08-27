/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { CancellationToken, CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { errorHandler } from '../../../../../base/common/errors.js';
import { Emitter } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { ITextModel } from '../../../../../editor/common/model.js';
import { createTextModel } from '../../../../../editor/test/common/testTextModel.js';
import { LanguageFeaturesService } from '../../../../../editor/common/services/languageFeaturesService.js';
import {
	DocumentSemanticTokensProvider,
	SemanticTokens,
	SemanticTokensLegend,
} from '../../../../../editor/common/languages.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { QUARTO_NATIVE_LANGUAGE_FEATURES_KEY } from '../../common/positronQuartoConfig.js';
import { IQuartoVirtualCell, IQuartoVirtualNotebookService } from '../../browser/quartoVirtualNotebookService.js';
import { QuartoEmbeddedSemanticTokens } from '../../browser/quartoEmbeddedSemanticTokens.js';

// The source document, with an R chunk on lines 4 and 5 and a Python chunk on
// lines 9 and 10:
//
//    1  # Intro
//    2
//    3  ```{r}
//    4  x <- 1
//    5  y <- 2
//    6  ```
//    7
//    8  ```{python}
//    9  a = 1
//   10  b = 2
//   11  ```
const SOURCE = [
	'# Intro', '', '```{r}', 'x <- 1', 'y <- 2', '```', '',
	'```{python}', 'a = 1', 'b = 2', '```', '',
].join('\n');
const SOURCE_URI = URI.file('/test/doc.qmd');
const R_CELL_URI = URI.parse('vscode-notebook-cell:/test/doc.qmd#ch0');
const PYTHON_CELL_URI = URI.parse('vscode-notebook-cell:/test/doc.qmd#ch1');

const R_LEGEND: SemanticTokensLegend = {
	tokenTypes: ['variable', 'function'],
	tokenModifiers: ['declaration'],
};
// Overlaps the R legend on `function` but at a different index, and adds names
// the R legend does not have, which is what the union has to reconcile.
const PYTHON_LEGEND: SemanticTokensLegend = {
	tokenTypes: ['function', 'class'],
	tokenModifiers: ['async'],
};

/** One token on the given cell-relative line, delta encoded as a stream of one. */
function tokenStream(line: number, startChar: number, tokenType: number, tokenModifiers = 0): Uint32Array {
	return new Uint32Array([line, startChar, 1, tokenType, tokenModifiers]);
}

describe('QuartoEmbeddedSemanticTokens', () => {
	const ctx = createTestContainer().build();

	let languageFeatures: LanguageFeaturesService;
	let configurationService: TestConfigurationService;
	let sourceModel: ITextModel;
	let rCell: IQuartoVirtualCell;
	let pythonCell: IQuartoVirtualCell;
	let calls: string[];

	beforeEach(async () => {
		calls = [];
		languageFeatures = new LanguageFeaturesService();
		configurationService = new TestConfigurationService();
		await configurationService.setUserConfiguration(QUARTO_NATIVE_LANGUAGE_FEATURES_KEY, true);

		sourceModel = createTextModel(SOURCE, 'quarto', undefined, SOURCE_URI);
		ctx.disposables.add(sourceModel);

		const rModel = createTextModel('x <- 1\ny <- 2', 'r', undefined, R_CELL_URI);
		ctx.disposables.add(rModel);
		rCell = { cellUri: R_CELL_URI, handle: 0, language: 'r', codeStartLine: 4, codeEndLine: 5, textModel: rModel };

		const pythonModel = createTextModel('a = 1\nb = 2', 'python', undefined, PYTHON_CELL_URI);
		ctx.disposables.add(pythonModel);
		pythonCell = {
			cellUri: PYTHON_CELL_URI, handle: 1, language: 'python',
			codeStartLine: 9, codeEndLine: 10, textModel: pythonModel,
		};
	});

	/** Builds the contribution, which is what registers the provider. */
	function createContribution(cells: IQuartoVirtualCell[]): void {
		const virtualNotebooks = stubInterface<IQuartoVirtualNotebookService>({
			whenReady: () => Promise.resolve(),
			ensureSynchronized: () => { calls.push('ensureSynchronized'); },
			getAllCells: () => cells,
			getCells: (uri) => uri.toString() === SOURCE_URI.toString() ? cells : [],
			getSourceUriForCell: (uri) =>
				cells.some(c => c.cellUri.toString() === uri.toString()) ? SOURCE_URI : undefined,
		});
		ctx.disposables.add(new QuartoEmbeddedSemanticTokens(
			virtualNotebooks, languageFeatures, configurationService, new NullLogService()));
	}

	/** A downstream provider registered on a cell's language, as a real one would be. */
	function registerTokens(
		name: string,
		language: string,
		legend: SemanticTokensLegend,
		respond: (model: ITextModel) => Uint32Array | undefined
	): void {
		ctx.disposables.add(languageFeatures.documentSemanticTokensProvider.register({ language }, {
			getLegend: () => legend,
			provideDocumentSemanticTokens: (model) => {
				calls.push(`${name}:${model.uri.toString()}`);
				const data = respond(model);
				return data ? { data } : null;
			},
			releaseDocumentSemanticTokens: () => { calls.push(`${name}:release`); },
		}));
	}

	/**
	 * A downstream provider that answers only for a range, as
	 * `typescript-language-features` registers.
	 */
	function registerRangeTokens(
		name: string,
		language: string,
		legend: SemanticTokensLegend,
		data: Uint32Array
	): void {
		ctx.disposables.add(languageFeatures.documentRangeSemanticTokensProvider.register({ language }, {
			getLegend: () => legend,
			provideDocumentRangeSemanticTokens: (model, range) => {
				calls.push(`${name}:${model.uri.toString()}@${range.startLineNumber}-${range.endLineNumber}`);
				return { data };
			},
		}));
	}

	function provider(): DocumentSemanticTokensProvider {
		return languageFeatures.documentSemanticTokensProvider.ordered(sourceModel)[0];
	}

	async function provide(token = CancellationToken.None): Promise<SemanticTokens | null> {
		const result = await provider().provideDocumentSemanticTokens(sourceModel, null, token);
		return result as SemanticTokens | null;
	}

	it('merges two cells into one stream at their source lines, through a union legend', async () => {
		// `variable` is R index 0, `function` is Python index 0. They must not
		// both come back as union index 0.
		registerTokens('r', 'r', R_LEGEND, () => tokenStream(0, 0, 0));
		registerTokens('python', 'python', PYTHON_LEGEND, () => tokenStream(1, 2, 0));
		createContribution([rCell, pythonCell]);

		expect({
			legend: provider().getLegend(),
			data: Array.from((await provide())!.data),
		}).toEqual({
			// First-seen order: the R legend's names, then the names the Python
			// legend adds.
			legend: {
				tokenTypes: ['variable', 'function', 'class'],
				tokenModifiers: ['declaration', 'async'],
			},
			data: [
				// R cell line 0 is source line 3, zero based. `variable` stays
				// union index 0.
				3, 0, 1, 0, 0,
				// Python cell line 1 is source line 9, six lines further down.
				// `function` becomes union index 1.
				6, 2, 1, 1, 0,
			],
		});
	});

	it('falls back to a range provider for a cell whose language registers only one', async () => {
		// `typescript-language-features` registers a range provider alone, so an
		// `{ojs}` or `{js}` chunk has nothing in the document registry. Core
		// makes the same fallback for a document with no document provider, and
		// so does the command the Quarto extension's vdoc path goes through, so
		// without this those chunks would lose tokens they have today.
		registerRangeTokens('ts', 'r', R_LEGEND, tokenStream(1, 0, 1));
		createContribution([rCell]);

		const data = Array.from((await provide())!.data);

		expect({
			// Cell line 1 is source line 4, zero based.
			data,
			// Asked over the cell's whole range, not the source document's.
			askedOver: calls.filter(c => c.startsWith('ts:')),
		}).toEqual({
			data: [4, 0, 1, 1, 0],
			askedOver: [`ts:${R_CELL_URI.toString()}@1-2`],
		});
	});

	it('prefers a document provider over a range provider for the same cell', async () => {
		// Core's own fallback order: a range provider is what you use when there
		// is no document provider, not an extra opinion to merge in.
		registerTokens('document', 'r', R_LEGEND, () => tokenStream(0, 0, 0));
		registerRangeTokens('range', 'r', R_LEGEND, tokenStream(1, 0, 1));
		createContribution([rCell]);

		expect({
			data: Array.from((await provide())!.data),
			rangeProviderAsked: calls.some(c => c.startsWith('range:')),
		}).toEqual({ data: [3, 0, 1, 0, 0], rangeProviderAsked: false });
	});

	it('covers a range-only provider in the legend', async () => {
		// The legend has to be able to express whichever registry answers.
		registerRangeTokens('ts', 'r', PYTHON_LEGEND, tokenStream(0, 0, 1));
		createContribution([rCell]);

		expect(provider().getLegend()).toEqual(PYTHON_LEGEND);
	});

	it('takes the first provider that answers for a cell, and asks no further', async () => {
		// Positron runs more than one server per language, so merging every
		// answer would colour the same text twice.
		registerTokens('first', 'r', R_LEGEND, () => tokenStream(0, 0, 0));
		registerTokens('second', 'r', R_LEGEND, () => tokenStream(1, 4, 1));
		createContribution([rCell]);

		const data = Array.from((await provide())!.data);

		expect({
			providersAsked: calls.filter(c => c === 'first:' + R_CELL_URI.toString()
				|| c === 'second:' + R_CELL_URI.toString()).length,
			tokenCount: data.length / 5,
		}).toEqual({ providersAsked: 1, tokenCount: 1 });
	});

	it('keeps the other cells when one cell\'s provider throws, and does not rethrow', async () => {
		// `getDocumentSemanticTokens` looks at every provider's error before any
		// provider's tokens and rethrows the first one, so an escaping error
		// would discard the Quarto extension's answer too.
		const reported: unknown[] = [];
		const previousHandler = errorHandler.getUnexpectedErrorHandler();
		errorHandler.setUnexpectedErrorHandler(error => reported.push(error));
		try {
			registerTokens('r', 'r', R_LEGEND, () => { throw new Error('server went away'); });
			registerTokens('python', 'python', PYTHON_LEGEND, () => tokenStream(0, 0, 0));
			createContribution([rCell, pythonCell]);

			expect({
				// Only the Python cell's token, lifted to source line 8.
				data: Array.from((await provide())!.data),
				reported: reported.map(error => (error as Error).message),
			}).toEqual({
				data: [8, 0, 1, 1, 0],
				reported: ['server went away'],
			});
		} finally {
			errorHandler.setUnexpectedErrorHandler(previousHandler);
		}
	});

	it('picks up a language whose server registers after the document is open', async () => {
		// The case that decides whether this feature works in practice: Pyrefly
		// is the only Python semantic tokens provider Positron has, and it
		// registers when the extension host gets there rather than at startup.
		// Widening the legend and colouring the new cell have to both happen off
		// that one registry change.
		registerTokens('r', 'r', R_LEGEND, () => tokenStream(0, 0, 0));
		createContribution([rCell, pythonCell]);
		const before = Array.from((await provide())!.data);

		registerTokens('latecomer', 'python', { tokenTypes: ['comment'], tokenModifiers: [] },
			() => tokenStream(0, 0, 0));

		expect({
			before,
			legend: provider().getLegend().tokenTypes,
			after: Array.from((await provide())!.data),
		}).toEqual({
			// The R cell's token alone, at source line 3.
			before: [3, 0, 1, 0, 0],
			legend: ['variable', 'function', 'comment'],
			// Now the Python cell answers too, at source line 8, with `comment`
			// at the union index it was just given.
			after: [3, 0, 1, 0, 0, 5, 0, 1, 2, 0],
		});
	});

	it('replaces the provider when a new server widens the legend', async () => {
		// The legend the editor holds is cached per provider instance and is not
		// re-read on a registry change, so widening it means handing over a
		// different provider.
		registerTokens('r', 'r', R_LEGEND, () => tokenStream(0, 0, 0));
		createContribution([rCell, pythonCell]);
		const before = provider();

		registerTokens('python', 'python', PYTHON_LEGEND, () => tokenStream(0, 0, 0));
		const after = provider();

		expect({
			replaced: before !== after,
			legendBefore: before.getLegend().tokenTypes,
			legendAfter: after.getLegend().tokenTypes,
		}).toEqual({
			replaced: true,
			legendBefore: ['variable', 'function'],
			legendAfter: ['variable', 'function', 'class'],
		});
	});

	it('keeps the same provider when a registry change leaves the names alone', async () => {
		// Re-registering re-tokenizes every open Quarto document, so a server
		// that adds nothing new must not cost that.
		registerTokens('r', 'r', R_LEGEND, () => tokenStream(0, 0, 0));
		createContribution([rCell]);
		const before = provider();

		registerTokens('second', 'r', R_LEGEND, () => tokenStream(0, 0, 0));

		expect(provider()).toBe(before);
	});

	it('registers nothing until some server declares a legend', async () => {
		// Cold start: the contribution is created before any language server
		// has registered, and heals when the first one does.
		createContribution([rCell]);
		const beforeAnyServer = languageFeatures.documentSemanticTokensProvider.ordered(sourceModel).length;

		registerTokens('r', 'r', R_LEGEND, () => tokenStream(0, 0, 0));

		expect({
			beforeAnyServer,
			afterFirstServer: languageFeatures.documentSemanticTokensProvider.ordered(sourceModel).length,
		}).toEqual({ beforeAnyServer: 0, afterFirstServer: 1 });
	});

	it('registers nothing while the setting is off', async () => {
		await configurationService.setUserConfiguration(QUARTO_NATIVE_LANGUAGE_FEATURES_KEY, false);
		registerTokens('r', 'r', R_LEGEND, () => tokenStream(0, 0, 0));
		createContribution([rCell]);

		expect(languageFeatures.documentSemanticTokensProvider.ordered(sourceModel)).toEqual([]);
	});

	it('answers nothing for a document with no code cells', async () => {
		registerTokens('r', 'r', R_LEGEND, () => tokenStream(0, 0, 0));
		createContribution([rCell]);

		// A prose-only document has cells nowhere, so the service reports none
		// for it.
		const proseOnly = createTextModel('# Just prose', 'quarto', undefined, URI.file('/test/prose.qmd'));
		ctx.disposables.add(proseOnly);

		expect(await provider().provideDocumentSemanticTokens(proseOnly, null, CancellationToken.None)).toBeNull();
	});

	it('forwards a downstream server\'s refresh to the Quarto document', async () => {
		// A server that finishes indexing and asks for a refresh, which is what
		// Pyrefly does on a cold project, cannot reach a Quarto document on its
		// own: `handleProviderDidChange` ignores providers outside
		// `registry.all(quartoModel)`, and a Python or R provider scores zero
		// there. Without this the colours stay stale until the user types.
		const downstreamChange = new Emitter<void>();
		ctx.disposables.add(downstreamChange);
		ctx.disposables.add(languageFeatures.documentSemanticTokensProvider.register({ language: 'r' }, {
			onDidChange: downstreamChange.event,
			getLegend: () => R_LEGEND,
			provideDocumentSemanticTokens: () => ({ data: tokenStream(0, 0, 0) }),
			releaseDocumentSemanticTokens: () => { },
		}));
		createContribution([rCell]);

		let fired = 0;
		ctx.disposables.add(provider().onDidChange!(() => { fired++; }));
		downstreamChange.fire();

		expect(fired).toBe(1);
	});

	it('ignores a refresh from a server that answers for no open cell', async () => {
		// Firing re-tokenizes every open Quarto document. Most of the registry is
		// languages that appear in no chunk, and a Go server reindexing has
		// nothing to say about a document of R and prose.
		const goChange = new Emitter<void>();
		ctx.disposables.add(goChange);
		ctx.disposables.add(languageFeatures.documentSemanticTokensProvider.register({ language: 'go' }, {
			onDidChange: goChange.event,
			getLegend: () => R_LEGEND,
			provideDocumentSemanticTokens: () => ({ data: tokenStream(0, 0, 0) }),
			releaseDocumentSemanticTokens: () => { },
		}));
		createContribution([rCell]);

		let fired = 0;
		ctx.disposables.add(provider().onDidChange!(() => { fired++; }));
		goChange.fire();

		expect(fired).toBe(0);
	});

	it('forwards a refresh for a language whose first chunk appeared after registration', async () => {
		// The reason this is judged when the event arrives rather than when the
		// subscription is made. Cells change with no event to rebind a
		// subscription list on, so a list built from the cells open at
		// registration would never learn about this server.
		const pythonChange = new Emitter<void>();
		ctx.disposables.add(pythonChange);
		ctx.disposables.add(languageFeatures.documentSemanticTokensProvider.register({ language: 'python' }, {
			onDidChange: pythonChange.event,
			getLegend: () => PYTHON_LEGEND,
			provideDocumentSemanticTokens: () => ({ data: tokenStream(0, 0, 0) }),
			releaseDocumentSemanticTokens: () => { },
		}));

		// The document holds only an R chunk when the provider is registered.
		const cells = [rCell];
		createContribution(cells);

		let fired = 0;
		ctx.disposables.add(provider().onDidChange!(() => { fired++; }));
		pythonChange.fire();
		const beforePythonChunk = fired;

		// The user writes a `{python}` chunk. `createContribution` closed over
		// this array, as the service's own cells would change under it.
		cells.push(pythonCell);
		pythonChange.fire();

		expect({ beforePythonChunk, afterPythonChunk: fired }).toEqual({
			beforePythonChunk: 0,
			afterPythonChunk: 1,
		});
	});

	it('answers nothing when every token was dropped as outside its cell', async () => {
		// The tokens survive the legend but not the span guard, which runs when
		// the stream is encoded. Counting before that would call this an answer
		// and hand back an empty stream, which the editor counts as tokens and
		// which would suppress the Quarto extension's own answer.
		registerTokens('r', 'r', R_LEGEND, () => tokenStream(40, 0, 0));
		createContribution([rCell]);

		expect(await provide()).toBeNull();
	});

	it('answers nothing when no cell had a provider to ask', async () => {
		// Today's state for R and Python both: a legend exists because some
		// other language declared one, but nothing answers for these cells. Null
		// rather than an empty stream, so the Quarto extension's own answer is
		// still the one the editor takes.
		registerTokens('typescript', 'typescript', R_LEGEND, () => tokenStream(0, 0, 0));
		createContribution([rCell, pythonCell]);

		expect(await provide()).toBeNull();
	});

	it('rejects a cancelled request rather than answering null', async () => {
		// A null answer means "this provider has no tokens", and the editor
		// clears the model's semantic tokens on it. A cancellation leaves the
		// colours from the pass that superseded this one alone.
		registerTokens('r', 'r', R_LEGEND, () => tokenStream(0, 0, 0));
		createContribution([rCell]);

		const cancelled = new CancellationTokenSource();
		cancelled.cancel();

		await expect(provide(cancelled.token)).rejects.toThrow();
	});

	it('releases a result id even when the answer is one it cannot use', async () => {
		// The leak this prevents: a server holds state for a delta request we
		// never send, and requests re-run on every edit, so a result skipped
		// without being released is one it keeps for the session.
		ctx.disposables.add(languageFeatures.documentSemanticTokensProvider.register({ language: 'r' }, {
			getLegend: () => R_LEGEND,
			// An edits response, which is a server ignoring that we sent no
			// lastResultId, so there is nothing to apply it to.
			provideDocumentSemanticTokens: () => ({ resultId: 'r-edits', edits: [] }),
			releaseDocumentSemanticTokens: (resultId) => { calls.push(`release:${resultId}`); },
		}));
		createContribution([rCell]);

		await provide();

		expect(calls.filter(c => c.startsWith('release:'))).toEqual(['release:r-edits']);
	});

	it('synchronizes the cells before reading them', async () => {
		// A pending sync rebuilds the cells and disposes the models they held, so
		// a model read first would be one that is about to be thrown away.
		registerTokens('r', 'r', R_LEGEND, () => tokenStream(0, 0, 0));
		createContribution([rCell]);

		await provide();

		expect(calls.indexOf('ensureSynchronized')).toBeLessThan(calls.indexOf(`r:${R_CELL_URI.toString()}`));
	});

	it('releases a result id it was handed, having asked for no deltas', async () => {
		// We never send a lastResultId, so a server holding state for a delta we
		// will never request would hold it forever.
		ctx.disposables.add(languageFeatures.documentSemanticTokensProvider.register({ language: 'r' }, {
			getLegend: () => R_LEGEND,
			provideDocumentSemanticTokens: () => ({ resultId: 'r-1', data: tokenStream(0, 0, 0) }),
			releaseDocumentSemanticTokens: (resultId) => { calls.push(`release:${resultId}`); },
		}));
		createContribution([rCell]);

		await provide();

		expect(calls.filter(c => c.startsWith('release:'))).toEqual(['release:r-1']);
	});
});
