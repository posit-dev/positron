/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

/**
 * @fileoverview Tests for the dirty/revert contract of PositronNotebookEditorInput.
 *
 * The editor group's close flow depends on this contract to handle "Don't Save"
 * correctly (see editorGroupView.doHandleCloseConfirmation): a dirty input must
 * report dirty so the save prompt shows, revert must forward to the notebook
 * editor model so the working copy is reverted from disk, and after a
 * successful revert the input must report clean so the close is not vetoed.
 * Regression coverage for the "Don't Save appears to not work" class of bugs.
 */

import { Emitter, Event } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { IRevertOptions } from '../../../../common/editor.js';
import { IResolvedNotebookEditorModel } from '../../../notebook/common/notebookCommon.js';
import { INotebookEditorModelResolverService } from '../../../notebook/common/notebookEditorModelResolverService.js';
import { PositronNotebookEditorInput } from '../../browser/PositronNotebookEditorInput.js';
import { notebookTestBuilder } from './testUtils.js';

const NOTEBOOK_URI = URI.file('/test/notebook.ipynb');
const VIEW_TYPE = 'jupyter-notebook';

describe('PositronNotebookEditorInput dirty/revert contract', () => {
	/** Mutable dirty state of the fake notebook editor model. */
	let modelIsDirty = false;

	const onDidChangeDirty = new Emitter<void>();
	const revertSpy = vi.fn(async (_options?: IRevertOptions) => {
		// Mirror the real SimpleNotebookEditorModel: revert makes the working
		// copy clean and fires a dirty state change.
		modelIsDirty = false;
		onDidChangeDirty.fire();
	});
	const refDisposeSpy = vi.fn();

	// Minimal IResolvedNotebookEditorModel stub for the members the input uses.
	const fakeModel: Partial<IResolvedNotebookEditorModel> = {
		resource: NOTEBOOK_URI,
		viewType: VIEW_TYPE,
		isResolved: (): this is IResolvedNotebookEditorModel => true,
		isDirty: () => modelIsDirty,
		isReadonly: () => false,
		load: async () => fakeModel as IResolvedNotebookEditorModel,
		revert: revertSpy,
		onDidChangeDirty: onDidChangeDirty.event,
		onDidChangeReadonly: Event.None,
		onDidRevertUntitled: Event.None,
	};

	const ctx = notebookTestBuilder()
		.stub(INotebookEditorModelResolverService, {
			resolve: () => Promise.resolve({
				object: fakeModel as IResolvedNotebookEditorModel,
				dispose: refDisposeSpy,
			}),
		})
		.build();

	function createInput(): PositronNotebookEditorInput {
		return ctx.disposables.add(ctx.instantiationService.createInstance(
			PositronNotebookEditorInput,
			NOTEBOOK_URI,
			{},
			VIEW_TYPE,
		));
	}

	beforeEach(() => {
		modelIsDirty = false;
	});

	it('reports clean before the model is resolved', () => {
		const input = createInput();
		expect(input.isDirty()).toBe(false);
	});

	it('reflects the model dirty state after resolve', async () => {
		const input = createInput();
		await input.resolve();

		expect(input.isDirty()).toBe(false);

		modelIsDirty = true;
		expect(input.isDirty()).toBe(true);
	});

	it('fires onDidChangeDirty when the model dirty state changes', async () => {
		const input = createInput();
		await input.resolve();

		const listener = vi.fn();
		ctx.disposables.add(input.onDidChangeDirty(listener));
		onDidChangeDirty.fire();

		expect(listener).toHaveBeenCalledTimes(1);
	});

	it('revert forwards to the model and leaves the input clean', async () => {
		const input = createInput();
		await input.resolve();
		modelIsDirty = true;

		await input.revert(0);

		expect(revertSpy).toHaveBeenCalledTimes(1);
		// After a successful revert the close flow checks isDirty() again and
		// vetoes the close if it is still true, so this must report false.
		expect(input.isDirty()).toBe(false);
	});

	it('revert forwards revert options to the model', async () => {
		const input = createInput();
		await input.resolve();
		modelIsDirty = true;

		await input.revert(0, { soft: true });

		expect(revertSpy).toHaveBeenCalledWith({ soft: true });
	});

	it('revert is a no-op when the model is clean', async () => {
		const input = createInput();
		await input.resolve();

		await input.revert(0);

		expect(revertSpy).not.toHaveBeenCalled();
	});

	it('revert is a no-op before the model is resolved', async () => {
		const input = createInput();

		await input.revert(0);

		expect(revertSpy).not.toHaveBeenCalled();
	});

	it('dispose releases the model reference', async () => {
		const input = createInput();
		await input.resolve();

		input.dispose();

		expect(refDisposeSpy).toHaveBeenCalledTimes(1);
	});
});
