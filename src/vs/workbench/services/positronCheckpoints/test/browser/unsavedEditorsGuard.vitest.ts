/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { URI } from '../../../../../base/common/uri.js';
import { IDialogService, IPrompt } from '../../../../../platform/dialogs/common/dialogs.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { IWorkingCopy, WorkingCopyCapabilities } from '../../../workingCopy/common/workingCopy.js';
import { IWorkingCopyService } from '../../../workingCopy/common/workingCopyService.js';
import { countUnsavedInProject, guardUnsavedEditors, UnsavedEditorsDecision } from '../../browser/unsavedEditorsGuard.js';

const projectRoot = URI.file('/work/project');

type FakeWorkingCopy = IWorkingCopy & { save: ReturnType<typeof vi.fn<() => Promise<boolean>>> };

function fakeWorkingCopy(path: string, options: { untitled?: boolean; saveResult?: boolean } = {}): FakeWorkingCopy {
	const save = vi.fn(async () => options.saveResult ?? true);
	return stubInterface<IWorkingCopy>({
		resource: URI.file(path),
		capabilities: options.untitled ? WorkingCopyCapabilities.Untitled : WorkingCopyCapabilities.None,
		save,
	}) as FakeWorkingCopy;
}

describe('unsavedEditorsGuard', () => {
	let dirty: IWorkingCopy[] = [];
	/** The label of the button to press, or undefined to press the cancel button. */
	let pressLabel: string | undefined;
	let prompted: IPrompt<UnsavedEditorsDecision>[] = [];
	const error = vi.fn();

	const ctx = createTestContainer()
		.stub(IWorkingCopyService, { get dirtyWorkingCopies() { return dirty; } })
		.stub(IDialogService, {
			prompt: async (prompt: IPrompt<UnsavedEditorsDecision>) => {
				prompted.push(prompt);
				const button = prompt.buttons?.find(candidate => candidate.label === pressLabel);
				const chosen = button ?? (prompt.cancelButton as { run: () => UnsavedEditorsDecision });
				return { result: await chosen.run({ checkboxChecked: false }) };
			},
			error,
		})
		.build();

	beforeEach(() => {
		dirty = [];
		pressLabel = undefined;
		prompted = [];
		error.mockClear();
	});

	function guard(mode: 'checkpoint' | 'file-changing') {
		return ctx.instantiationService.invokeFunction(accessor => guardUnsavedEditors(accessor, projectRoot, mode));
	}

	function labels(): (string | undefined)[] {
		const prompt = prompted[0];
		return [...(prompt.buttons ?? []).map(button => button.label), (prompt.cancelButton as { label: string }).label];
	}

	test('no unsaved files proceeds without a dialog', async () => {
		expect(await guard('checkpoint')).toBe('proceed');
		expect(await guard('file-changing')).toBe('proceed');
		expect(prompted).toEqual([]);
	});

	test('checkpoint mode with unsaved files offers save, continue without, cancel', async () => {
		dirty = [fakeWorkingCopy('/work/project/a.R'), fakeWorkingCopy('/work/project/b.R')];

		await guard('checkpoint');

		expect(labels()).toEqual(['Save 2 files and include them', 'Continue without the unsaved edits', 'Cancel']);
	});

	test('file-changing mode offers save and cancel only', async () => {
		dirty = [fakeWorkingCopy('/work/project/a.R')];

		await guard('file-changing');

		expect(labels()).toEqual(['Save all and continue', 'Cancel']);
	});

	test('save choice saves every unsaved file in the project', async () => {
		const first = fakeWorkingCopy('/work/project/a.R');
		const second = fakeWorkingCopy('/work/project/sub/b.R');
		dirty = [first, second];
		pressLabel = 'Save 2 files and include them';

		expect(await guard('checkpoint')).toBe('proceed');

		expect(first.save).toHaveBeenCalledTimes(1);
		expect(second.save).toHaveBeenCalledTimes(1);
	});

	test('file-changing save choice saves and proceeds', async () => {
		const file = fakeWorkingCopy('/work/project/a.R');
		dirty = [file];
		pressLabel = 'Save all and continue';

		expect(await guard('file-changing')).toBe('proceed');
		expect(file.save).toHaveBeenCalledTimes(1);
	});

	test('continue without leaves the files unsaved', async () => {
		const file = fakeWorkingCopy('/work/project/a.R');
		dirty = [file];
		pressLabel = 'Continue without the unsaved edits';

		expect(await guard('checkpoint')).toBe('proceed-without-unsaved');
		expect(file.save).not.toHaveBeenCalled();
	});

	test('cancel saves nothing and cancels', async () => {
		const file = fakeWorkingCopy('/work/project/a.R');
		dirty = [file];

		expect(await guard('checkpoint')).toBe('cancel');
		expect(await guard('file-changing')).toBe('cancel');
		expect(file.save).not.toHaveBeenCalled();
	});

	test('a failed save cancels and tells the person', async () => {
		dirty = [fakeWorkingCopy('/work/project/a.R', { saveResult: false }), fakeWorkingCopy('/work/project/b.R')];
		pressLabel = 'Save 2 files and include them';

		expect(await guard('checkpoint')).toBe('cancel');
		expect(error).toHaveBeenCalledWith('1 file could not be saved. Nothing was changed.');
	});

	test('untitled files and files outside the project are ignored', async () => {
		const inside = fakeWorkingCopy('/work/project/a.R');
		const untitled = fakeWorkingCopy('/work/project/Untitled-1', { untitled: true });
		const outside = fakeWorkingCopy('/work/other/c.R');
		const sibling = fakeWorkingCopy('/work/project-two/d.R');
		dirty = [inside, untitled, outside, sibling];
		pressLabel = 'Save 1 file and include it';

		expect(countUnsavedInProject(ctx.get(IWorkingCopyService), projectRoot)).toBe(1);
		expect(await guard('checkpoint')).toBe('proceed');

		expect(inside.save).toHaveBeenCalledTimes(1);
		expect(untitled.save).not.toHaveBeenCalled();
		expect(outside.save).not.toHaveBeenCalled();
		expect(sibling.save).not.toHaveBeenCalled();
	});

	test('only untitled or outside files proceeds without a dialog', async () => {
		dirty = [fakeWorkingCopy('/work/project/Untitled-1', { untitled: true }), fakeWorkingCopy('/work/other/c.R')];

		expect(await guard('file-changing')).toBe('proceed');
		expect(prompted).toEqual([]);
	});
});
