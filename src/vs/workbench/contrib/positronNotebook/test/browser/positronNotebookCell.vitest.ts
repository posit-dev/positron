/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { VSBuffer } from '../../../../../base/common/buffer.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { CellEditType, CellKind, NotebookCellsChangeType } from '../../../notebook/common/notebookCommon.js';
import { createTestPositronNotebookInstance, TestPositronNotebookInstance } from './testPositronNotebookInstance.js';
import { PositronNotebookCodeCell } from '../../browser/PositronNotebookCells/PositronNotebookCodeCell.js';

describe('PositronNotebookCell', () => {
	const ctx = createTestContainer().withNotebookEditorServices().build();

	let notebook: TestPositronNotebookInstance;
	let cell: PositronNotebookCodeCell;

	beforeEach(() => {
		notebook = createTestPositronNotebookInstance(
			[['print("hello")', 'python', CellKind.Code]], ctx
		);
		cell = notebook.cells.get()[0] as PositronNotebookCodeCell;
		expect(cell.isCodeCell(), 'Expected cell to be a code cell').toBe(true);
	});

	describe('Output scrolling state', () => {
		it('outputScrolling defaults to undefined', () => {
			expect(cell.outputScrolling.get()).toBe(undefined);
		});

		it('truncateOutput sets outputScrolling to false', () => {
			cell.truncateOutput();
			expect(cell.outputScrolling.get()).toBe(false);
		});

		it('showFullOutput sets outputScrolling to true', () => {
			cell.showFullOutput();
			expect(cell.outputScrolling.get()).toBe(true);
		});

		it('collapse and expand does not affect scrolling state', () => {
			// Verify with scrolling = true (showing full output)
			cell.showFullOutput();
			cell.collapseOutput();
			expect(cell.outputScrolling.get()).toBe(true);
			cell.expandOutput();
			expect(cell.outputScrolling.get()).toBe(true);

			// Verify with scrolling = false (truncated)
			cell.truncateOutput();
			cell.collapseOutput();
			expect(cell.outputScrolling.get()).toBe(false);
			cell.expandOutput();
			expect(cell.outputScrolling.get()).toBe(false);
		});

		it('new output resets scrolling state to undefined', () => {
			const textModel = notebook.textModel;
			expect(textModel).toBeDefined();

			const applyNewOutput = () => textModel!.applyEdits([{
				editType: CellEditType.Output,
				index: 0,
				outputs: [{
					outputId: `output-${Math.random()}`,
					outputs: [{ mime: 'application/vnd.code.notebook.stdout', data: VSBuffer.fromString('new output') }],
				}],
				append: false,
			}], true, undefined, () => undefined, undefined, false);

			// Reset from showing full output (true -> undefined)
			cell.showFullOutput();
			expect(cell.outputScrolling.get()).toBe(true);
			applyNewOutput();
			expect(cell.outputScrolling.get()).toBe(undefined);

			// Reset from truncated (false -> undefined)
			cell.truncateOutput();
			expect(cell.outputScrolling.get()).toBe(false);
			applyNewOutput();
			expect(cell.outputScrolling.get()).toBe(undefined);
		});
	});

});

describe('PositronNotebookCell tags', () => {
	const ctx = createTestContainer().withNotebookEditorServices().build();

	/** Create a single-code-cell notebook, seeding the cell's metadata. */
	function createCellWithMetadata(metadata: Record<string, unknown>): PositronNotebookCodeCell {
		const notebook = createTestPositronNotebookInstance([{
			source: 'print("hello")',
			mime: undefined,
			language: 'python',
			cellKind: CellKind.Code,
			outputs: [],
			metadata,
			internalMetadata: {},
		}], ctx);
		return notebook.cells.get()[0] as PositronNotebookCodeCell;
	}

	it('reads tags from the nested nbformat metadata location', () => {
		// On reload the ipynb deserializer stores the file's cell metadata under
		// `metadata.metadata`, so the observable must read tags from there.
		const cell = createCellWithMetadata({ metadata: { tags: ['seeded'] } });
		expect(cell.tags.get()).toEqual(['seeded']);
	});

	it('de-duplicates tags read from an externally authored file', () => {
		// nbformat tags are a set of labels, but a hand-edited file can carry
		// duplicates. Collapsing them on read (first occurrence wins, order
		// preserved) keeps the tag-bar UI's "values are unique" assumption true.
		const cell = createCellWithMetadata({ metadata: { tags: ['dup', 'dup', 'x'] } });
		expect(cell.tags.get()).toEqual(['dup', 'x']);
	});

	it('drops non-string tag entries and de-duplicates the rest', () => {
		// tags is untrusted file data; an external writer can violate the
		// string-array contract. Non-string entries are filtered out (rather than
		// rendered as garbage) and survivors are de-duplicated.
		const cell = createCellWithMetadata({ metadata: { tags: ['ok', 42, null, 'ok', { x: 1 }] } });
		expect(cell.tags.get()).toEqual(['ok']);
	});

	it('treats a non-array tags value as no tags', () => {
		// A malformed scalar/object tags value must not throw when read (e.g.
		// spreading a non-iterable); it is ignored entirely.
		const cell = createCellWithMetadata({ metadata: { tags: 'not-an-array' } });
		expect(cell.tags.get()).toEqual([]);
	});

	it('ignores tags at the non-persisted top-level metadata location', () => {
		// The ipynb serializer never writes top-level cell metadata to the file,
		// so tags found there are not real and must be ignored.
		const cell = createCellWithMetadata({ tags: ['ignored'] });
		expect(cell.tags.get()).toEqual([]);
	});

	it('setTags writes to the nested location, not the top level', () => {
		const cell = createCellWithMetadata({});
		cell.setTags(['important', 'wip']);

		expect((cell.model.metadata.metadata as Record<string, unknown>).tags).toEqual(['important', 'wip']);
		expect(cell.model.metadata.tags).toBeUndefined();
		expect(cell.tags.get()).toEqual(['important', 'wip']);
	});

	it('setTags preserves sibling nested metadata keys', () => {
		// PartialMetadata is a shallow top-level merge, so the nested object is
		// replaced wholesale unless setTags spreads it. Verify collapsed state
		// and the vscode language id survive a tag edit.
		const cell = createCellWithMetadata({
			metadata: { collapsed: true, vscode: { languageId: 'python' } },
		});
		cell.setTags(['tag']);

		expect(cell.model.metadata.metadata).toEqual({
			collapsed: true,
			vscode: { languageId: 'python' },
			tags: ['tag'],
		});
	});

	it('setTags([]) drops the tags key per nbformat convention', () => {
		const cell = createCellWithMetadata({ metadata: { tags: ['gone'], collapsed: true } });
		cell.setTags([]);

		expect(cell.model.metadata.metadata).toEqual({ collapsed: true });
		expect(cell.tags.get()).toEqual([]);
	});

	it('setTags ignores a non-object nested metadata value instead of spreading it', () => {
		// metadata.metadata is untrusted; spreading a scalar would inject numeric
		// keys (e.g. {0:'a',1:'b',...}). A malformed value is dropped and only the
		// tag metadata is written.
		const cell = createCellWithMetadata({ metadata: 'abc' });
		cell.setTags(['tag']);

		expect(cell.model.metadata.metadata).toEqual({ tags: ['tag'] });
	});

	it('setTags skips the write when the tag list is unchanged', () => {
		// applyEdits replaces the metadata object (a new reference) and fires a
		// change even for identical content, which would add an undo entry and
		// dirty the notebook. A no-op (e.g. committing a tag edit without changes)
		// must leave the metadata object untouched.
		const cell = createCellWithMetadata({ metadata: { tags: ['a', 'b'] } });
		const before = cell.model.metadata;

		expect(cell.setTags(['a', 'b'])).toBe(true);
		expect(cell.model.metadata).toBe(before);
	});

	it('addTag trims, appends, and reports "added"', () => {
		const cell = createCellWithMetadata({ metadata: { tags: ['first'] } });

		expect(cell.addTag('  second  ')).toBe('added');
		expect(cell.tags.get()).toEqual(['first', 'second']);
	});

	it('addTag reports "empty" and adds nothing for a whitespace-only tag', () => {
		const cell = createCellWithMetadata({ metadata: { tags: ['first'] } });

		expect(cell.addTag('   ')).toBe('empty');
		expect(cell.tags.get()).toEqual(['first']);
	});

	it('addTag reports "duplicate" and adds nothing for an existing tag', () => {
		const cell = createCellWithMetadata({ metadata: { tags: ['dup'] } });

		expect(cell.addTag('  dup  ')).toBe('duplicate');
		expect(cell.tags.get()).toEqual(['dup']);
	});

	it('addTag reports "failed" when the write cannot be applied to a detached cell', () => {
		// Once the cell is removed from the notebook its index is -1, so setTags
		// no-ops. addTag must report that instead of claiming the tag was added.
		const cell = createCellWithMetadata({ metadata: { tags: ['first'] } });
		cell.delete();

		expect(cell.addTag('second')).toBe('failed');
	});
});

/** Tests to ensure that the test harness is correctly setup, useful for debugging the test harness */
describe('PositronNotebookCell Test Harness', () => {
	const ctx = createTestContainer().withNotebookEditorServices().build();

	it('cells have editors auto-attached', () => {
		const notebook = createTestPositronNotebookInstance(
			[['print("hello")', 'python', CellKind.Code]], ctx
		);

		const cell = notebook.cells.get()[0];
		expect(cell.currentEditor, 'Cell should have an auto-attached editor').toBeDefined();

		const editorModel = cell.currentEditor!.getModel();
		expect(editorModel, 'Cell editor should have a model').not.toBeNull();

		expect(cell.getContent(), 'Cell content should match editor model value').toBe(editorModel!.getValue());
		expect(cell.model.textModel, 'Cell model should be the editor model').toBe(editorModel);
	});

	it('setValue propagates through the content change event chain', () => {
		const notebook = createTestPositronNotebookInstance(
			[['original content', 'python', CellKind.Code]], ctx);

		const cell = notebook.cells.get()[0];
		const notebookModel = notebook.textModel!;

		// Link 1: NotebookCellTextModel fires onDidChangeContent when textModel changes
		let cellContentFired = false;
		ctx.disposables.add(cell.model.onDidChangeContent((e) => {
			if (e === 'content' || (typeof e === 'object' && e.type === 'model')) {
				cellContentFired = true;
			}
		}));

		// Link 2: NotebookTextModel fires onDidChangeContent with ChangeCellContent
		let notebookModelFired = false;
		ctx.disposables.add(notebookModel.onDidChangeContent((e) => {
			if (e.rawEvents.some(
				event => event.kind === NotebookCellsChangeType.ChangeCellContent ||
					event.kind === NotebookCellsChangeType.ModelChange)) {
				notebookModelFired = true;
			}
		}));

		cell.model.textModel!.setValue('new content');

		expect(cellContentFired, 'NotebookCellTextModel.onDidChangeContent should fire when textModel.setValue() is called').toBe(true);
		expect(notebookModelFired, 'NotebookTextModel.onDidChangeContent should fire when textModel.setValue() is called').toBe(true);
	});
});
