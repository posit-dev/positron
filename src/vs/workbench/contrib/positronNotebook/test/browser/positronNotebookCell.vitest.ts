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

	it('normalizes tags read from cell metadata', () => {
		// tags live under the nested `metadata.metadata` (the only location the
		// ipynb serializer persists) and are untrusted file data, so the read drops
		// non-strings, dedupes, and ignores a non-array or a top-level value.
		const tagsFor = (metadata: Record<string, unknown>) =>
			createCellWithMetadata(metadata).tags.get();

		expect({
			nested: tagsFor({ metadata: { tags: ['seeded'] } }),
			malformedEntries: tagsFor({ metadata: { tags: ['ok', 42, null, 'ok', { x: 1 }] } }),
			nonArray: tagsFor({ metadata: { tags: 'not-an-array' } }),
			topLevel: tagsFor({ tags: ['ignored'] }),
		}).toEqual({
			nested: ['seeded'],
			malformedEntries: ['ok'],
			nonArray: [],
			topLevel: [],
		});
	});

	it('a tag write lands in the nested location, not the top level', () => {
		const cell = createCellWithMetadata({});
		expect(cell.addTag('important')).toBe('ok');
		expect(cell.addTag('wip')).toBe('ok');

		expect((cell.model.metadata.metadata as Record<string, unknown>).tags).toEqual(['important', 'wip']);
		expect(cell.model.metadata.tags).toBeUndefined();
		expect(cell.tags.get()).toEqual(['important', 'wip']);
	});

	it('a tag write preserves sibling nested metadata keys', () => {
		// PartialMetadata is a shallow top-level merge, so the nested object is
		// replaced wholesale unless the write spreads it. Verify collapsed state
		// and the vscode language id survive a tag edit.
		const cell = createCellWithMetadata({
			metadata: { collapsed: true, vscode: { languageId: 'python' } },
		});
		expect(cell.addTag('tag')).toBe('ok');

		expect(cell.model.metadata.metadata).toEqual({
			collapsed: true,
			vscode: { languageId: 'python' },
			tags: ['tag'],
		});
	});

	it('removing the last tag drops the tags key per nbformat convention', () => {
		const cell = createCellWithMetadata({ metadata: { tags: ['gone'], collapsed: true } });
		expect(cell.removeTag('gone')).toBe('ok');

		expect(cell.model.metadata.metadata).toEqual({ collapsed: true });
		expect(cell.tags.get()).toEqual([]);
	});

	it('a tag write ignores a non-object nested metadata value instead of spreading it', () => {
		// metadata.metadata is untrusted; spreading a scalar would inject numeric
		// keys (e.g. {0:'a',1:'b',...}). A malformed value is dropped and only the
		// tag metadata is written.
		const cell = createCellWithMetadata({ metadata: 'abc' });
		expect(cell.addTag('tag')).toBe('ok');

		expect(cell.model.metadata.metadata).toEqual({ tags: ['tag'] });
	});

	it('a no-op tag write is skipped and leaves the metadata object untouched', () => {
		// applyEdits replaces the metadata object (a new reference) and fires a
		// change even for identical content, which would add an undo entry and
		// dirty the notebook. Renaming a tag to its current value is a no-op and
		// must leave the metadata object untouched.
		const cell = createCellWithMetadata({ metadata: { tags: ['a', 'b'] } });
		const before = cell.model.metadata;

		expect(cell.renameTag('a', 'a')).toBe('ok');
		expect(cell.model.metadata).toBe(before);
	});

	it('addTag trims, appends, and reports "ok"', () => {
		const cell = createCellWithMetadata({ metadata: { tags: ['first'] } });

		expect(cell.addTag('  second  ')).toBe('ok');
		expect(cell.tags.get()).toEqual(['first', 'second']);
	});

	it('addTag is a silent no-op for a whitespace-only tag', () => {
		const cell = createCellWithMetadata({ metadata: { tags: ['first'] } });

		expect(cell.addTag('   ')).toBe('ok');
		expect(cell.tags.get()).toEqual(['first']);
	});

	it('addTag reports "duplicate" and adds nothing for an existing tag', () => {
		const cell = createCellWithMetadata({ metadata: { tags: ['dup'] } });

		expect(cell.addTag('  dup  ')).toBe('duplicate');
		expect(cell.tags.get()).toEqual(['dup']);
	});

	it('addTag reports "failed" when the write cannot be applied to a detached cell', () => {
		// Once the cell is removed from the notebook its index is -1, so the write
		// no-ops. addTag must report that instead of claiming the tag was added.
		const cell = createCellWithMetadata({ metadata: { tags: ['first'] } });
		cell.delete();

		expect(cell.addTag('second')).toBe('failed');
	});

	it('removeTag filters the tag and reports success', () => {
		const cell = createCellWithMetadata({ metadata: { tags: ['a', 'b', 'c'] } });

		expect(cell.removeTag('b')).toBe('ok');
		expect(cell.tags.get()).toEqual(['a', 'c']);
	});

	it('removeTag is a no-op success for a tag that is not present', () => {
		const cell = createCellWithMetadata({ metadata: { tags: ['a'] } });
		const before = cell.model.metadata;

		expect(cell.removeTag('missing')).toBe('ok');
		expect(cell.model.metadata).toBe(before);
		expect(cell.tags.get()).toEqual(['a']);
	});

	it('renameTag trims, replaces in place, and reports "ok"', () => {
		const cell = createCellWithMetadata({ metadata: { tags: ['old', 'keep'] } });

		expect(cell.renameTag('old', '  new  ')).toBe('ok');
		expect(cell.tags.get()).toEqual(['new', 'keep']);
	});

	it('renameTag is a silent no-op for a whitespace-only value', () => {
		const cell = createCellWithMetadata({ metadata: { tags: ['old'] } });

		expect(cell.renameTag('old', '   ')).toBe('ok');
		expect(cell.tags.get()).toEqual(['old']);
	});

	it('renameTag reports "duplicate" when the new value is another existing tag', () => {
		const cell = createCellWithMetadata({ metadata: { tags: ['a', 'b'] } });

		expect(cell.renameTag('a', 'b')).toBe('duplicate');
		expect(cell.tags.get()).toEqual(['a', 'b']);
	});

	it('renameTag reports "failed" when the original tag is no longer present', () => {
		const cell = createCellWithMetadata({ metadata: { tags: ['a'] } });

		expect(cell.renameTag('missing', 'new')).toBe('failed');
		expect(cell.tags.get()).toEqual(['a']);
	});

	it('tag writes fail on a read-only notebook', () => {
		// Tag edits are document mutations, so a read-only notebook rejects them
		// at the setTags choke point and the verbs report 'failed'.
		const notebook = createTestPositronNotebookInstance([{
			source: 'print("hello")',
			mime: undefined,
			language: 'python',
			cellKind: CellKind.Code,
			outputs: [],
			metadata: { metadata: { tags: ['seeded'] } },
			internalMetadata: {},
		}], ctx);
		vi.spyOn(notebook, 'isReadOnly', 'get').mockReturnValue(true);
		const cell = notebook.cells.get()[0];

		expect({
			add: cell.addTag('new'),
			remove: cell.removeTag('seeded'),
			rename: cell.renameTag('seeded', 'renamed'),
			tags: cell.tags.get(),
		}).toEqual({
			add: 'failed',
			remove: 'failed',
			rename: 'failed',
			tags: ['seeded'],
		});
	});

	it('tagUIVisible folds tags, an in-progress add, and the notebook-wide hide toggle', () => {
		// The cell owns the tag UI visibility predicate the tag bar and the code
		// cell footer both render against.
		const notebook = createTestPositronNotebookInstance([{
			source: 'print("hello")',
			mime: undefined,
			language: 'python',
			cellKind: CellKind.Code,
			outputs: [],
			metadata: {},
			internalMetadata: {},
		}], ctx);
		const cell = notebook.cells.get()[0];
		expect(cell.tagUIVisible.get()).toBe(false);

		// An in-progress add shows the UI on an untagged cell; ending it hides it.
		cell.beginAddTag();
		expect(cell.tagUIVisible.get()).toBe(true);
		cell.endAddTag();
		expect(cell.tagUIVisible.get()).toBe(false);

		expect(cell.addTag('tag')).toBe('ok');
		expect(cell.tagUIVisible.get()).toBe(true);

		// The notebook-wide toggle hides the UI without touching the tags.
		notebook.toggleCellTagsHidden();
		expect(cell.tagUIVisible.get()).toBe(false);
		expect(cell.tags.get()).toEqual(['tag']);
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
