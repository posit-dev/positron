/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'assert';
import { IDisposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { Position } from '../../../../common/core/position.js';
import { Range } from '../../../../common/core/range.js';
import { TextModel } from '../../../../common/model/textModel.js';
import { CompletionItemKind, CompletionItemProvider } from '../../../../common/languages.js';
import { CompletionOptions, provideSuggestionItems, SnippetSortOrder } from '../../browser/suggest.js';
import { createTextModel } from '../../../../test/common/testTextModel.js';
import { LanguageFeatureRegistry } from '../../../../common/languageFeatureRegistry.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';


suite('Suggest', function () {
	let model: TextModel;
	let registration: IDisposable;
	let registry: LanguageFeatureRegistry<CompletionItemProvider>;

	setup(function () {
		registry = new LanguageFeatureRegistry();
		model = createTextModel('FOO\nbar\BAR\nfoo', undefined, undefined, URI.parse('foo:bar/path'));
		registration = registry.register({ pattern: 'bar/path', scheme: 'foo' }, {
			_debugDisplayName: 'test',
			provideCompletionItems(_doc, pos) {
				return {
					incomplete: false,
					suggestions: [{
						label: 'aaa',
						kind: CompletionItemKind.Snippet,
						insertText: 'aaa',
						range: Range.fromPositions(pos)
					}, {
						label: 'zzz',
						kind: CompletionItemKind.Snippet,
						insertText: 'zzz',
						range: Range.fromPositions(pos)
					}, {
						label: 'fff',
						kind: CompletionItemKind.Property,
						insertText: 'fff',
						range: Range.fromPositions(pos)
					}]
				};
			}
		});
	});

	teardown(() => {
		registration.dispose();
		model.dispose();
	});

	ensureNoDisposablesAreLeakedInTestSuite();

	test('sort - snippet inline', async function () {
		const { items, disposable } = await provideSuggestionItems(registry, model, new Position(1, 1), new CompletionOptions(SnippetSortOrder.Inline));
		assert.strictEqual(items.length, 3);
		assert.strictEqual(items[0].completion.label, 'aaa');
		assert.strictEqual(items[1].completion.label, 'fff');
		assert.strictEqual(items[2].completion.label, 'zzz');
		disposable.dispose();
	});

	test('sort - snippet top', async function () {
		const { items, disposable } = await provideSuggestionItems(registry, model, new Position(1, 1), new CompletionOptions(SnippetSortOrder.Top));
		assert.strictEqual(items.length, 3);
		assert.strictEqual(items[0].completion.label, 'aaa');
		assert.strictEqual(items[1].completion.label, 'zzz');
		assert.strictEqual(items[2].completion.label, 'fff');
		disposable.dispose();
	});

	test('sort - snippet bottom', async function () {
		const { items, disposable } = await provideSuggestionItems(registry, model, new Position(1, 1), new CompletionOptions(SnippetSortOrder.Bottom));
		assert.strictEqual(items.length, 3);
		assert.strictEqual(items[0].completion.label, 'fff');
		assert.strictEqual(items[1].completion.label, 'aaa');
		assert.strictEqual(items[2].completion.label, 'zzz');
		disposable.dispose();
	});

	test('sort - snippet none', async function () {
		const { items, disposable } = await provideSuggestionItems(registry, model, new Position(1, 1), new CompletionOptions(undefined, new Set<CompletionItemKind>().add(CompletionItemKind.Snippet)));
		assert.strictEqual(items.length, 1);
		assert.strictEqual(items[0].completion.label, 'fff');
		disposable.dispose();
	});

	test('only from', function (callback) {

		const foo: any = {
			triggerCharacters: [],
			provideCompletionItems() {
				return {
					currentWord: '',
					incomplete: false,
					suggestions: [{
						label: 'jjj',
						type: 'property',
						insertText: 'jjj'
					}]
				};
			}
		};
		const registration = registry.register({ pattern: 'bar/path', scheme: 'foo' }, foo);

		provideSuggestionItems(registry, model, new Position(1, 1), new CompletionOptions(undefined, undefined, new Set<CompletionItemProvider>().add(foo))).then(({ items, disposable }) => {
			registration.dispose();

			assert.strictEqual(items.length, 1);
			assert.ok(items[0].provider === foo);
			disposable.dispose();
			callback();
		});
	});

	test('Ctrl+space completions stopped working with the latest Insiders, #97650', async function () {


		const foo = new class implements CompletionItemProvider {

			_debugDisplayName = 'test';
			triggerCharacters = [];

			provideCompletionItems() {
				return {
					suggestions: [{
						label: 'one',
						kind: CompletionItemKind.Class,
						insertText: 'one',
						range: {
							insert: new Range(0, 0, 0, 0),
							replace: new Range(0, 0, 0, 10)
						}
					}, {
						label: 'two',
						kind: CompletionItemKind.Class,
						insertText: 'two',
						range: {
							insert: new Range(0, 0, 0, 0),
							replace: new Range(0, 1, 0, 10)
						}
					}]
				};
			}
		};

		const registration = registry.register({ pattern: 'bar/path', scheme: 'foo' }, foo);
		const { items, disposable } = await provideSuggestionItems(registry, model, new Position(0, 0), new CompletionOptions(undefined, undefined, new Set<CompletionItemProvider>().add(foo)));
		registration.dispose();

		assert.strictEqual(items.length, 2);
		const [a, b] = items;

		assert.strictEqual(a.completion.label, 'one');
		assert.strictEqual(a.isInvalid, false);
		assert.strictEqual(b.completion.label, 'two');
		assert.strictEqual(b.isInvalid, true);
		disposable.dispose();
	});

	// --- Start Positron ---
	suite('priority', function () {

		test('dedup keeps higher priority', async function () {
			// Two providers return items with same insertText, one at priority 1 and one at -1.
			// Assert only the priority=1 item survives.
			const reg2 = registry.register({ pattern: 'bar/path', scheme: 'foo' }, {
				_debugDisplayName: 'test-high',
				provideCompletionItems(_doc, pos) {
					return {
						incomplete: false,
						suggestions: [{
							label: 'dupe-high',
							kind: CompletionItemKind.Variable,
							insertText: 'dupe',
							range: Range.fromPositions(pos),
							priority: 1,
						}]
					};
				}
			});

			const reg3 = registry.register({ pattern: 'bar/path', scheme: 'foo' }, {
				_debugDisplayName: 'test-low',
				provideCompletionItems(_doc, pos) {
					return {
						incomplete: false,
						suggestions: [{
							label: 'dupe-low',
							kind: CompletionItemKind.Variable,
							insertText: 'dupe',
							range: Range.fromPositions(pos),
							priority: -1,
						}]
					};
				}
			});

			const { items, disposable } = await provideSuggestionItems(registry, model, new Position(1, 1), new CompletionOptions(SnippetSortOrder.Inline));
			// Should contain items from the base registration (aaa, zzz, fff) plus one deduped 'dupe'
			const dupeItems = items.filter(i => i.completion.insertText === 'dupe');
			assert.strictEqual(dupeItems.length, 1);
			assert.strictEqual(dupeItems[0].completion.label, 'dupe-high');
			assert.strictEqual(dupeItems[0].completion.priority, 1);
			disposable.dispose();
			reg2.dispose();
			reg3.dispose();
		});

		test('dedup keeps first when equal priority', async function () {
			const reg2 = registry.register({ pattern: 'bar/path', scheme: 'foo' }, {
				_debugDisplayName: 'test-first',
				provideCompletionItems(_doc, pos) {
					return {
						incomplete: false,
						suggestions: [{
							label: 'dupe-first',
							kind: CompletionItemKind.Variable,
							insertText: 'dupe',
							range: Range.fromPositions(pos),
							priority: 5,
						}]
					};
				}
			});

			const reg3 = registry.register({ pattern: 'bar/path', scheme: 'foo' }, {
				_debugDisplayName: 'test-second',
				provideCompletionItems(_doc, pos) {
					return {
						incomplete: false,
						suggestions: [{
							label: 'dupe-second',
							kind: CompletionItemKind.Variable,
							insertText: 'dupe',
							range: Range.fromPositions(pos),
							priority: 5,
						}]
					};
				}
			});

			const { items, disposable } = await provideSuggestionItems(registry, model, new Position(1, 1), new CompletionOptions(SnippetSortOrder.Inline));
			const dupeItems = items.filter(i => i.completion.insertText === 'dupe');
			assert.strictEqual(dupeItems.length, 1);
			// First seen wins when priorities are equal
			assert.strictEqual(dupeItems[0].completion.label, 'dupe-first');
			disposable.dispose();
			reg2.dispose();
			reg3.dispose();
		});

		test('no dedup for different insertText', async function () {
			const reg2 = registry.register({ pattern: 'bar/path', scheme: 'foo' }, {
				_debugDisplayName: 'test-a',
				provideCompletionItems(_doc, pos) {
					return {
						incomplete: false,
						suggestions: [{
							label: 'unique-a',
							kind: CompletionItemKind.Variable,
							insertText: 'uniqueA',
							range: Range.fromPositions(pos),
							priority: 1,
						}]
					};
				}
			});

			const reg3 = registry.register({ pattern: 'bar/path', scheme: 'foo' }, {
				_debugDisplayName: 'test-b',
				provideCompletionItems(_doc, pos) {
					return {
						incomplete: false,
						suggestions: [{
							label: 'unique-b',
							kind: CompletionItemKind.Variable,
							insertText: 'uniqueB',
							range: Range.fromPositions(pos),
							priority: -1,
						}]
					};
				}
			});

			const { items, disposable } = await provideSuggestionItems(registry, model, new Position(1, 1), new CompletionOptions(SnippetSortOrder.Inline));
			const uniqueA = items.filter(i => i.completion.insertText === 'uniqueA');
			const uniqueB = items.filter(i => i.completion.insertText === 'uniqueB');
			assert.strictEqual(uniqueA.length, 1);
			assert.strictEqual(uniqueB.length, 1);
			disposable.dispose();
			reg2.dispose();
			reg3.dispose();
		});

		test('sort by priority', async function () {
			const reg2 = registry.register({ pattern: 'bar/path', scheme: 'foo' }, {
				_debugDisplayName: 'test-sort',
				provideCompletionItems(_doc, pos) {
					return {
						incomplete: false,
						suggestions: [{
							label: 'zzz-low',
							kind: CompletionItemKind.Variable,
							insertText: 'zzzLow',
							range: Range.fromPositions(pos),
							priority: -1,
						}, {
							label: 'aaa-high',
							kind: CompletionItemKind.Variable,
							insertText: 'aaaHigh',
							range: Range.fromPositions(pos),
							priority: 10,
						}]
					};
				}
			});

			const { items, disposable } = await provideSuggestionItems(registry, model, new Position(1, 1), new CompletionOptions(SnippetSortOrder.Inline));
			const priorityItems = items.filter(i => i.completion.insertText === 'aaaHigh' || i.completion.insertText === 'zzzLow');
			assert.strictEqual(priorityItems.length, 2);
			// Higher priority sorts first, regardless of label alphabetical order
			assert.strictEqual(priorityItems[0].completion.insertText, 'aaaHigh');
			assert.strictEqual(priorityItems[1].completion.insertText, 'zzzLow');
			disposable.dispose();
			reg2.dispose();
		});

		test('undefined priority defaults to 0', async function () {
			const reg2 = registry.register({ pattern: 'bar/path', scheme: 'foo' }, {
				_debugDisplayName: 'test-default',
				provideCompletionItems(_doc, pos) {
					return {
						incomplete: false,
						suggestions: [{
							label: 'has-priority',
							kind: CompletionItemKind.Variable,
							insertText: 'hasPriority',
							range: Range.fromPositions(pos),
							priority: 1,
						}, {
							label: 'no-priority',
							kind: CompletionItemKind.Variable,
							insertText: 'noPriority',
							range: Range.fromPositions(pos),
							// no priority set - should default to 0
						}]
					};
				}
			});

			const { items, disposable } = await provideSuggestionItems(registry, model, new Position(1, 1), new CompletionOptions(SnippetSortOrder.Inline));
			const testItems = items.filter(i => i.completion.insertText === 'hasPriority' || i.completion.insertText === 'noPriority');
			assert.strictEqual(testItems.length, 2);
			// priority-1 item sorts before undefined-priority (0) item
			assert.strictEqual(testItems[0].completion.insertText, 'hasPriority');
			assert.strictEqual(testItems[1].completion.insertText, 'noPriority');
			disposable.dispose();
			reg2.dispose();
		});
	});
	// --- End Positron ---
});
