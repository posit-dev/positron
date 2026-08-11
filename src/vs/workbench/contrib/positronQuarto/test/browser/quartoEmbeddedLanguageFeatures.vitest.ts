/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { URI } from '../../../../../base/common/uri.js';
import { Position } from '../../../../../editor/common/core/position.js';
import { ITextModel } from '../../../../../editor/common/model.js';
import { createTextModel } from '../../../../../editor/test/common/testTextModel.js';
import { LanguageFeaturesService } from '../../../../../editor/common/services/languageFeaturesService.js';
import {
	CompletionItemKind,
	CompletionItemProvider,
	CompletionList,
	DefinitionProvider,
	Hover,
	HoverProvider,
	Location,
	LocationLink,
	SignatureHelpProvider,
	SignatureHelpResult,
} from '../../../../../editor/common/languages.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { QUARTO_NATIVE_LANGUAGE_FEATURES_KEY } from '../../common/positronQuartoConfig.js';
import { IQuartoVirtualCell, IQuartoVirtualNotebookService } from '../../browser/quartoVirtualNotebookService.js';
import { QuartoEmbeddedLanguageFeatures } from '../../browser/quartoEmbeddedLanguageFeatures.js';

// The source document, with the R chunk's code on lines 4 and 5:
//
//   1  # Intro
//   2
//   3  ```{r}
//   4  x <- 1
//   5  y <- 2
//   6  ```
const SOURCE = ['# Intro', '', '```{r}', 'x <- 1', 'y <- 2', '```', ''].join('\n');
const SOURCE_URI = URI.file('/test/doc.qmd');
const CELL_URI = URI.parse('vscode-notebook-cell:/test/doc.qmd#ch0');

// Line 4 of the source is line 1 of the cell.
const IN_CELL = new Position(4, 3);
const IN_PROSE = new Position(1, 1);

describe('QuartoEmbeddedLanguageFeatures', () => {
	const ctx = createTestContainer().build();

	let languageFeatures: LanguageFeaturesService;
	let configurationService: TestConfigurationService;
	let sourceModel: ITextModel;
	let cellModel: ITextModel;
	let cell: IQuartoVirtualCell;
	let calls: string[];

	beforeEach(async () => {
		calls = [];
		languageFeatures = new LanguageFeaturesService();
		configurationService = new TestConfigurationService();
		await configurationService.setUserConfiguration(QUARTO_NATIVE_LANGUAGE_FEATURES_KEY, true);

		sourceModel = createTextModel(SOURCE, 'quarto', undefined, SOURCE_URI);
		ctx.disposables.add(sourceModel);
		cellModel = createTextModel('x <- 1\ny <- 2', 'r', undefined, CELL_URI);
		ctx.disposables.add(cellModel);

		cell = {
			cellUri: CELL_URI,
			handle: 0,
			language: 'r',
			codeStartLine: 4,
			codeEndLine: 5,
			textModel: cellModel,
		};
	});

	/**
	 * Builds the contribution, which is what registers the providers.
	 *
	 * `alwaysFindCell` makes the service claim a cell for every URI, including a
	 * cell's own. Nothing does that in production, which is why forwarding cannot
	 * loop there, but it is what makes the recursion guard observable.
	 */
	function createFeatures(options: { alwaysFindCell?: IQuartoVirtualCell; cells?: IQuartoVirtualCell[] } = {}): void {
		const cells = options.cells ?? [cell];
		const virtualNotebooks = stubInterface<IQuartoVirtualNotebookService>({
			ensureSynchronized: () => { calls.push('ensureSynchronized'); },
			getCellAtLine: (_uri, lineNumber) => {
				calls.push(`getCellAtLine:${lineNumber}`);
				if (options.alwaysFindCell) {
					return options.alwaysFindCell;
				}
				return lineNumber >= cell.codeStartLine && lineNumber <= cell.codeEndLine ? cell : undefined;
			},
			getAllCells: () => cells,
			getCells: () => cells,
			getSourceUriForCell: (uri) =>
				cells.some(c => c.cellUri.toString() === uri.toString()) ? SOURCE_URI : undefined,
		});
		ctx.disposables.add(new QuartoEmbeddedLanguageFeatures(
			virtualNotebooks, languageFeatures, configurationService, new NullLogService()));
	}

	function completionProvider(): CompletionItemProvider {
		return languageFeatures.completionProvider.ordered(sourceModel)[0];
	}

	/** A downstream provider registered on the cell's language, as a real one would be. */
	function registerCompletions(name: string, suggestions: CompletionList['suggestions']): void {
		ctx.disposables.add(languageFeatures.completionProvider.register({ language: 'r' }, {
			_debugDisplayName: name,
			provideCompletionItems: (model, position) => {
				calls.push(`${name}:${model.uri.toString()}@${position.lineNumber}:${position.column}`);
				return { suggestions };
			},
		}));
	}

	function suggestion(label: string, line: number) {
		return {
			label,
			kind: CompletionItemKind.Variable,
			insertText: label,
			range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 3 },
		};
	}

	it('forwards a completion request to the cell model and remaps the result', async () => {
		registerCompletions('downstream', [suggestion('xylophone', 1)]);
		createFeatures();

		const result = await completionProvider().provideCompletionItems(
			sourceModel, IN_CELL, { triggerKind: 0 }, CancellationToken.None);

		expect({
			// Called against the cell, at the cell-relative position.
			forwardedTo: calls.filter(c => c.startsWith('downstream:')),
			// Ranges come back in source document coordinates.
			range: result?.suggestions[0].range,
		}).toEqual({
			forwardedTo: [`downstream:${CELL_URI.toString()}@1:3`],
			range: { startLineNumber: 4, startColumn: 1, endLineNumber: 4, endColumn: 3 },
		});
	});

	it('synchronizes the cells before looking one up', async () => {
		// A sync can rebuild the cells and dispose the old models, so reading a
		// cell first would hand back a model that is about to be thrown away.
		registerCompletions('downstream', [suggestion('xylophone', 1)]);
		createFeatures();

		await completionProvider().provideCompletionItems(
			sourceModel, IN_CELL, { triggerKind: 0 }, CancellationToken.None);

		expect(calls.slice(0, 2)).toEqual(['ensureSynchronized', 'getCellAtLine:4']);
	});

	it('declines positions outside a cell, leaving prose to the Quarto server', async () => {
		registerCompletions('downstream', [suggestion('xylophone', 1)]);
		createFeatures();

		const result = await completionProvider().provideCompletionItems(
			sourceModel, IN_PROSE, { triggerKind: 0 }, CancellationToken.None);

		expect({
			result,
			forwarded: calls.some(c => c.startsWith('downstream:')),
		}).toEqual({ result: undefined, forwarded: false });
	});

	it('takes the first provider that answers and does not consult the rest', async () => {
		// Positron runs more than one language server per language. Merging their
		// answers duplicates every item, which is posit-dev/positron#13907.
		registerCompletions('alpha', [suggestion('from-alpha', 1)]);
		registerCompletions('beta', [suggestion('from-beta', 1)]);
		createFeatures();

		const result = await completionProvider().provideCompletionItems(
			sourceModel, IN_CELL, { triggerKind: 0 }, CancellationToken.None);

		// Which provider `ordered()` puts first is not part of the contract, so
		// the expectation is derived from whichever one was actually asked. What
		// matters is that exactly one was asked, and that its answer is returned
		// whole rather than merged with the other's.
		const consulted = calls.filter(c => c.startsWith('alpha:') || c.startsWith('beta:'));
		expect({
			consulted: consulted.length,
			labels: result?.suggestions.map(s => s.label),
		}).toEqual({
			consulted: 1,
			labels: [consulted[0].startsWith('alpha:') ? 'from-alpha' : 'from-beta'],
		});
	});

	it('moves past a provider with nothing to offer', async () => {
		// The registry breaks score ties by registration time, latest first, so
		// registering the empty one last is what puts it at the front.
		registerCompletions('answers', [suggestion('from-answers', 1)]);
		registerCompletions('empty', []);
		createFeatures();

		const result = await completionProvider().provideCompletionItems(
			sourceModel, IN_CELL, { triggerKind: 0 }, CancellationToken.None);

		expect({
			labels: result?.suggestions.map(s => s.label),
			consultedEmptyFirst: calls.filter(c => c.startsWith('empty:') || c.startsWith('answers:')),
		}).toEqual({
			labels: ['from-answers'],
			consultedEmptyFirst: [
				`empty:${CELL_URI.toString()}@1:3`,
				`answers:${CELL_URI.toString()}@1:3`,
			],
		});
	});

	it('remaps a completion range given as an insert and replace pair', async () => {
		// Servers commonly return this form instead of a single range, and both
		// halves are in cell coordinates.
		registerCompletions('downstream', [{
			label: 'xylophone',
			kind: CompletionItemKind.Variable,
			insertText: 'xylophone',
			range: {
				insert: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 2 },
				replace: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 4 },
			},
		}]);
		createFeatures();

		const result = await completionProvider().provideCompletionItems(
			sourceModel, IN_CELL, { triggerKind: 0 }, CancellationToken.None);

		expect(result?.suggestions[0].range).toEqual({
			insert: { startLineNumber: 4, startColumn: 1, endLineNumber: 4, endColumn: 2 },
			replace: { startLineNumber: 4, startColumn: 1, endLineNumber: 4, endColumn: 4 },
		});
	});

	it('moves past a provider that returns nothing at all', async () => {
		// Distinct from an empty list: a provider can decline outright.
		registerCompletions('answers', [suggestion('from-answers', 1)]);
		ctx.disposables.add(languageFeatures.completionProvider.register({ language: 'r' }, {
			_debugDisplayName: 'declines',
			provideCompletionItems: () => {
				calls.push('declines:called');
				return undefined;
			},
		}));
		createFeatures();

		const result = await completionProvider().provideCompletionItems(
			sourceModel, IN_CELL, { triggerKind: 0 }, CancellationToken.None);

		expect({
			labels: result?.suggestions.map(s => s.label),
			declinedFirst: calls.indexOf('declines:called') !== -1,
		}).toEqual({ labels: ['from-answers'], declinedFirst: true });
	});

	it('remaps the extra edits a completion carries, not only its own range', async () => {
		// This is how a server adds an import when you accept a symbol. Left in cell
		// coordinates it lands at the same line number of the Quarto document, which
		// is usually the frontmatter.
		registerCompletions('downstream', [{
			label: 'array',
			kind: CompletionItemKind.Variable,
			insertText: 'array',
			range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 3 },
			additionalTextEdits: [{
				range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 },
				text: 'import numpy as np\n',
			}],
		}]);
		createFeatures();

		const result = await completionProvider().provideCompletionItems(
			sourceModel, IN_CELL, { triggerKind: 0 }, CancellationToken.None);

		expect(result?.suggestions[0].additionalTextEdits).toEqual([{
			range: { startLineNumber: 4, startColumn: 1, endLineNumber: 4, endColumn: 1 },
			text: 'import numpy as np\n',
		}]);
	});

	it('resolves a completion through the provider that produced it', async () => {
		// The suggest widget looks for resolveCompletionItem on the provider it
		// called, which is ours, so without forwarding there is no documentation
		// panel and no lazily computed edits.
		ctx.disposables.add(languageFeatures.completionProvider.register({ language: 'r' }, {
			_debugDisplayName: 'downstream',
			provideCompletionItems: () => ({
				suggestions: [suggestion('xylophone', 1)],
			}),
			resolveCompletionItem: (item) => ({
				...item,
				detail: 'resolved detail',
				additionalTextEdits: [{
					range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 },
					text: 'library(dplyr)\n',
				}],
			}),
		}));
		createFeatures();

		const provider = completionProvider();
		const list = await provider.provideCompletionItems(
			sourceModel, IN_CELL, { triggerKind: 0 }, CancellationToken.None);
		const resolved = await provider.resolveCompletionItem!(list!.suggestions[0], CancellationToken.None);

		expect({
			detail: resolved?.detail,
			// Edits from resolution need the same remapping as the first response.
			edits: resolved?.additionalTextEdits,
		}).toEqual({
			detail: 'resolved detail',
			edits: [{
				range: { startLineNumber: 4, startColumn: 1, endLineNumber: 4, endColumn: 1 },
				text: 'library(dplyr)\n',
			}],
		});
	});

	it('returns the item unchanged when the provider cannot resolve', async () => {
		registerCompletions('downstream', [suggestion('xylophone', 1)]);
		createFeatures();

		const provider = completionProvider();
		const list = await provider.provideCompletionItems(
			sourceModel, IN_CELL, { triggerKind: 0 }, CancellationToken.None);
		const item = list!.suggestions[0];

		expect(await provider.resolveCompletionItem!(item, CancellationToken.None)).toBe(item);
	});

	it('returns nothing when the only provider has nothing to offer', async () => {
		registerCompletions('empty', []);
		createFeatures();

		const result = await completionProvider().provideCompletionItems(
			sourceModel, IN_CELL, { triggerKind: 0 }, CancellationToken.None);

		// An empty list is not an answer. Returning it would stop the suggest
		// widget from falling through to whatever else could contribute.
		expect(result).toBeUndefined();
	});

	it('does not forward to itself', async () => {
		// A cell whose code starts on line 1 maps every position to itself, and a
		// service that claims a cell for any URI keeps that going. Neither happens
		// in production, where a chunk always sits below its opening fence and a
		// cell URI has no notebook of its own, so those two facts are what make
		// forwarding terminate. This pins the guard that does not rely on either.
		const degenerate: IQuartoVirtualCell = { ...cell, codeStartLine: 1, codeEndLine: 6 };
		registerCompletions('downstream', [suggestion('xylophone', 1)]);
		createFeatures({ alwaysFindCell: degenerate });
		const provider = completionProvider();
		// Registered last, so the registry consults it before the downstream one.
		// Without the self-check this recurses until the stack gives out.
		ctx.disposables.add(languageFeatures.completionProvider.register({ language: 'r' }, provider));

		const result = await provider.provideCompletionItems(
			sourceModel, IN_CELL, { triggerKind: 0 }, CancellationToken.None);

		expect(result?.suggestions.map(s => s.label)).toEqual(['xylophone']);
	});

	it('forwards a hover to the cell model and remaps the range', async () => {
		ctx.disposables.add(languageFeatures.hoverProvider.register({ language: 'r' }, {
			provideHover: (model, position): Hover => {
				calls.push(`hover:${model.uri.toString()}@${position.lineNumber}:${position.column}`);
				return {
					contents: [{ value: 'docs' }],
					range: { startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 2 },
				};
			},
		} satisfies HoverProvider));
		createFeatures();

		const provider = languageFeatures.hoverProvider.ordered(sourceModel)[0];
		// Source line 5 is the cell's line 2.
		const result = await provider.provideHover(sourceModel, new Position(5, 4), CancellationToken.None);

		expect({
			forwardedTo: calls.filter(c => c.startsWith('hover:')),
			range: (result as Hover).range,
		}).toEqual({
			forwardedTo: [`hover:${CELL_URI.toString()}@2:4`],
			range: { startLineNumber: 5, startColumn: 1, endLineNumber: 5, endColumn: 2 },
		});
	});

	it('leaves a hover that carries no range alone', async () => {
		// Hovers often have no range, and the editor then uses the word at the
		// position. Inventing one, or dropping the hover, would both be wrong.
		ctx.disposables.add(languageFeatures.hoverProvider.register({ language: 'r' }, {
			provideHover: (): Hover => ({ contents: [{ value: 'docs' }] }),
		} satisfies HoverProvider));
		createFeatures();

		const provider = languageFeatures.hoverProvider.ordered(sourceModel)[0];
		const result = await provider.provideHover(sourceModel, IN_CELL, CancellationToken.None);

		expect(result).toEqual({ contents: [{ value: 'docs' }] });
	});

	it('remaps definitions inside the cell and passes other files through', async () => {
		const otherFile = URI.file('/test/helpers.R');
		ctx.disposables.add(languageFeatures.definitionProvider.register({ language: 'r' }, {
			provideDefinition: (model, position): LocationLink[] => {
				calls.push(`definition:${model.uri.toString()}@${position.lineNumber}:${position.column}`);
				return [
					{
						uri: CELL_URI,
						range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 2 },
						targetSelectionRange: { startLineNumber: 1, startColumn: 3, endLineNumber: 1, endColumn: 4 },
						originSelectionRange: { startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 2 },
					},
					{
						uri: otherFile,
						range: { startLineNumber: 7, startColumn: 1, endLineNumber: 7, endColumn: 2 },
					},
				];
			},
		} satisfies DefinitionProvider));
		createFeatures();

		const provider = languageFeatures.definitionProvider.ordered(sourceModel)[0];
		const result = await provider.provideDefinition(sourceModel, IN_CELL, CancellationToken.None);

		expect({
			forwardedTo: calls.filter(c => c.startsWith('definition:')),
			result,
		}).toEqual({
			forwardedTo: [`definition:${CELL_URI.toString()}@1:3`],
			result: [
				{
					// Points at the Quarto document, not the hidden cell.
					uri: SOURCE_URI,
					range: { startLineNumber: 4, startColumn: 1, endLineNumber: 4, endColumn: 2 },
					targetSelectionRange: { startLineNumber: 4, startColumn: 3, endLineNumber: 4, endColumn: 4 },
					originSelectionRange: { startLineNumber: 5, startColumn: 1, endLineNumber: 5, endColumn: 2 },
				},
				{
					// A different file is already in its own coordinates.
					uri: otherFile,
					range: { startLineNumber: 7, startColumn: 1, endLineNumber: 7, endColumn: 2 },
				},
			],
		});
	});

	it('moves past a definition provider that finds nothing', async () => {
		// Same rule as completions: an empty result is not an answer, so the next
		// provider gets a turn rather than the editor being told there is nothing.
		ctx.disposables.add(languageFeatures.definitionProvider.register({ language: 'r' }, {
			provideDefinition: (): LocationLink[] => [{
				uri: CELL_URI,
				range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 2 },
			}],
		} satisfies DefinitionProvider));
		ctx.disposables.add(languageFeatures.definitionProvider.register({ language: 'r' }, {
			provideDefinition: (): LocationLink[] => [],
		} satisfies DefinitionProvider));
		createFeatures();

		const provider = languageFeatures.definitionProvider.ordered(sourceModel)[0];
		const result = await provider.provideDefinition(sourceModel, IN_CELL, CancellationToken.None);

		expect(result).toEqual([{
			uri: SOURCE_URI,
			range: { startLineNumber: 4, startColumn: 1, endLineNumber: 4, endColumn: 2 },
		}]);
	});

	it('handles a definition returned as one location rather than a list', async () => {
		// `Definition` is `Location | Location[]`, and servers use both forms.
		ctx.disposables.add(languageFeatures.definitionProvider.register({ language: 'r' }, {
			provideDefinition: (): Location => ({
				uri: CELL_URI,
				range: { startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 2 },
			}),
		} satisfies DefinitionProvider));
		createFeatures();

		const provider = languageFeatures.definitionProvider.ordered(sourceModel)[0];
		const result = await provider.provideDefinition(sourceModel, IN_CELL, CancellationToken.None);

		expect(result).toEqual([{
			uri: SOURCE_URI,
			range: { startLineNumber: 5, startColumn: 1, endLineNumber: 5, endColumn: 2 },
		}]);
	});

	it('remaps a definition that lands in a different chunk', async () => {
		// Servers index every open document, so a definition can sit in an earlier
		// chunk. Returned as-is, the editor is handed a hidden cell URI it cannot
		// open, which is what Go to Definition would try to do.
		const otherCellUri = URI.parse('vscode-notebook-cell:/test/doc.qmd#ch1');
		const otherCell: IQuartoVirtualCell = {
			...cell, cellUri: otherCellUri, codeStartLine: 20, codeEndLine: 22,
		};
		ctx.disposables.add(languageFeatures.definitionProvider.register({ language: 'r' }, {
			provideDefinition: (): LocationLink[] => [{
				uri: otherCellUri,
				range: { startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 5 },
			}],
		} satisfies DefinitionProvider));
		createFeatures({ cells: [cell, otherCell] });

		const provider = languageFeatures.definitionProvider.ordered(sourceModel)[0];
		const result = await provider.provideDefinition(sourceModel, IN_CELL, CancellationToken.None);

		// Cell line 2 of a chunk starting at source line 20.
		expect(result).toEqual([{
			uri: SOURCE_URI,
			range: { startLineNumber: 21, startColumn: 1, endLineNumber: 21, endColumn: 5 },
		}]);
	});

	it('collects signature help retrigger characters as well as trigger characters', async () => {
		// The hint widget reads the two sets separately. Without the retrigger set a
		// hint never advances to the next parameter as you type past a comma.
		ctx.disposables.add(languageFeatures.signatureHelpProvider.register({ language: 'r' }, {
			signatureHelpTriggerCharacters: ['('],
			signatureHelpRetriggerCharacters: [',', ')'],
			provideSignatureHelp: () => undefined,
		} satisfies SignatureHelpProvider));
		createFeatures();

		const provider = languageFeatures.signatureHelpProvider.ordered(sourceModel)[0];
		expect({
			trigger: provider.signatureHelpTriggerCharacters?.slice().sort(),
			retrigger: provider.signatureHelpRetriggerCharacters?.slice().sort(),
		}).toEqual({
			trigger: ['('],
			retrigger: [')', ','],
		});
	});

	it('forwards signature help to the cell model and returns it unchanged', async () => {
		ctx.disposables.add(languageFeatures.signatureHelpProvider.register({ language: 'r' }, {
			provideSignatureHelp: (model, position): SignatureHelpResult => {
				calls.push(`signature:${model.uri.toString()}@${position.lineNumber}:${position.column}`);
				return {
					value: {
						signatures: [{ label: 'mean(x)', parameters: [] }],
						activeSignature: 0,
						activeParameter: 0,
					},
					dispose: () => { },
				};
			},
		} satisfies SignatureHelpProvider));
		createFeatures();

		const provider = languageFeatures.signatureHelpProvider.ordered(sourceModel)[0];
		const result = await provider.provideSignatureHelp(
			sourceModel, IN_CELL, CancellationToken.None,
			{ triggerKind: 1, isRetrigger: false });

		// Signature help has no ranges, so the only thing to get right is where
		// the request goes.
		expect({
			forwardedTo: calls.filter(c => c.startsWith('signature:')),
			label: result?.value.signatures[0].label,
		}).toEqual({
			forwardedTo: [`signature:${CELL_URI.toString()}@1:3`],
			label: 'mean(x)',
		});
	});

	it('takes its trigger characters from the servers behind the cells', async () => {
		// The suggest widget reads these from the providers on the document being
		// edited, so a character no cell provider asked for never fires, and one
		// they did ask for that we fail to repeat is silently dead.
		ctx.disposables.add(languageFeatures.completionProvider.register({ language: 'r' }, {
			_debugDisplayName: 'serverA',
			triggerCharacters: ['$', '@', ':'],
			provideCompletionItems: () => ({ suggestions: [] }),
		}));
		ctx.disposables.add(languageFeatures.completionProvider.register({ language: 'r' }, {
			_debugDisplayName: 'serverB',
			triggerCharacters: ['.', '%'],
			provideCompletionItems: () => ({ suggestions: [] }),
		}));
		createFeatures();

		expect(completionProvider().triggerCharacters?.slice().sort())
			.toEqual(['$', '%', '.', ':', '@']);
	});

	it('takes signature help trigger characters from the same place', async () => {
		ctx.disposables.add(languageFeatures.signatureHelpProvider.register({ language: 'r' }, {
			signatureHelpTriggerCharacters: ['(', ',', '='],
			provideSignatureHelp: () => undefined,
		} satisfies SignatureHelpProvider));
		createFeatures();

		const provider = languageFeatures.signatureHelpProvider.ordered(sourceModel)[0];
		expect(provider.signatureHelpTriggerCharacters?.slice().sort()).toEqual(['(', ',', '=']);
	});

	it('registers nothing while the setting is off', async () => {
		await configurationService.setUserConfiguration(QUARTO_NATIVE_LANGUAGE_FEATURES_KEY, false);
		registerCompletions('downstream', [suggestion('xylophone', 1)]);
		createFeatures();

		expect(languageFeatures.completionProvider.ordered(sourceModel)).toEqual([]);
	});
});
