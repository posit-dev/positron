/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { MenuId, MenuRegistry } from '../../../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IKeybindingService } from '../../../../../platform/keybinding/common/keybinding.js';
import { IQuickInputService, IQuickPickItem } from '../../../../../platform/quickinput/common/quickInput.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { TestQuickPick } from '../../../../../test/vitest/testQuickPick.js';
import { showNotebookCommandsQuickPick } from '../../browser/contrib/commands/NotebookCommandsAction.js';

interface ICommandPickItem extends IQuickPickItem {
	readonly commandId: string;
}

describe('showNotebookCommandsQuickPick', () => {
	// Reassigned each test; the IQuickInputService stub captures it by closure
	// so createQuickPick() returns the current double.
	let pick: TestQuickPick<ICommandPickItem>;
	const executeCommand = vi.fn(() => Promise.resolve(undefined));

	const ctx = createTestContainer()
		.stub(IQuickInputService, stubInterface<IQuickInputService>({
			createQuickPick: (() => pick.asQuickPick()) as IQuickInputService['createQuickPick'],
		}))
		.stub(ICommandService, { executeCommand })
		.stub(IKeybindingService, { lookupKeybinding: () => undefined })
		.build();

	let registrations: DisposableStore;

	beforeEach(() => {
		pick = ctx.disposables.add(new TestQuickPick<ICommandPickItem>());
		registrations = new DisposableStore();
		// A palette command under the positronNotebook. prefix -> included.
		registrations.add(MenuRegistry.addCommand({ id: 'positronNotebook.testAuto', title: 'Test Auto Command' }));
		registrations.add(MenuRegistry.appendMenuItem(MenuId.CommandPalette, { command: { id: 'positronNotebook.testAuto', title: 'Test Auto Command' } }));
		// A palette command without the prefix -> excluded.
		registrations.add(MenuRegistry.addCommand({ id: 'notebook.testOther', title: 'Other Command' }));
		registrations.add(MenuRegistry.appendMenuItem(MenuId.CommandPalette, { command: { id: 'notebook.testOther', title: 'Other Command' } }));
	});

	afterEach(() => {
		registrations.dispose();
	});

	function run(): void {
		showNotebookCommandsQuickPick(
			ctx.get(IQuickInputService),
			ctx.get(ICommandService),
			ctx.get(IKeybindingService),
		);
	}

	/** Register a palette command under the test's lifecycle. */
	function register(id: string, title: string): void {
		registrations.add(MenuRegistry.addCommand({ id, title }));
		registrations.add(MenuRegistry.appendMenuItem(MenuId.CommandPalette, { command: { id, title } }));
	}

	function items(): ICommandPickItem[] {
		return pick.items.filter((i): i is ICommandPickItem => i.type !== 'separator');
	}

	/** Map each command id to the separator label it sits under. Robust to
	 *  whatever other notebook commands the global registry carries. */
	function groupByCommand(): Map<string, string> {
		const groupOf = new Map<string, string>();
		let current = '';
		for (const i of pick.items) {
			if (i.type === 'separator') {
				current = i.label ?? '';
			} else {
				groupOf.set(i.commandId, current);
			}
		}
		return groupOf;
	}

	it('lists positronNotebook.-prefixed palette commands and excludes others', () => {
		run();
		const ids = items().map(i => i.commandId);
		expect(ids).toContain('positronNotebook.testAuto');
		expect(ids).not.toContain('notebook.testOther');
		pick.cancel(); // close the picker so its DisposableStore is released
	});

	it('excludes the picker\'s own command', () => {
		// The picker action is registered in the palette under the
		// positronNotebook. prefix, so it would be auto-included; it must not
		// list itself.
		registrations.add(MenuRegistry.addCommand({ id: 'positronNotebook.showCommands', title: 'Show Notebook Commands' }));
		registrations.add(MenuRegistry.appendMenuItem(MenuId.CommandPalette, { command: { id: 'positronNotebook.showCommands', title: 'Show Notebook Commands' } }));
		run();
		const ids = items().map(i => i.commandId);
		expect(ids).not.toContain('positronNotebook.showCommands');
		pick.cancel(); // close the picker so its DisposableStore is released
	});

	it('runs the selected command on accept', () => {
		run();
		const item = items().find(i => i.commandId === 'positronNotebook.testAuto')!;
		pick.accept(item);
		expect(executeCommand).toHaveBeenCalledTimes(1);
		expect(executeCommand).toHaveBeenCalledWith('positronNotebook.testAuto');
	});

	it('disables alphabetical sorting so the manual group order survives', () => {
		run();
		expect(pick.sortByLabel).toBe(false);
		pick.cancel();
	});

	it('resolves the label from an object-typed (localized) command title', () => {
		registrations.add(MenuRegistry.addCommand({ id: 'positronNotebook.testObjectTitle', title: { value: 'Localized Title', original: 'Localized Title' } }));
		registrations.add(MenuRegistry.appendMenuItem(MenuId.CommandPalette, { command: { id: 'positronNotebook.testObjectTitle', title: { value: 'Localized Title', original: 'Localized Title' } } }));
		run();
		const item = items().find(i => i.commandId === 'positronNotebook.testObjectTitle')!;
		expect(item.label).toBe('Localized Title');
		pick.cancel();
	});

	it('files a representative command from each group under the right separator', () => {
		// One command per named group, so a broken group label or a broken
		// id-match misfiles its command and fails here. A source-side typo in a
		// COMMAND_GROUPS id is not catchable without loading the real command
		// modules (deliberately not imported here); it surfaces as the command
		// dropping into Other in the running app.
		const expected: Record<string, string> = {
			'positronNotebook.runAllCells': 'Run',
			'positronNotebook.addCodeCell': 'Cells',
			'positronNotebook.clearAllOutputs': 'Outputs',
			'positronNotebook.selectKernel': 'Kernel',
			'positronNotebook.toggleOutline': 'View',
			'positronNotebook.askAssistant': 'Assistant',
			'positronNotebook.testAuto': 'Other', // unmapped -> catch-all
		};
		for (const id of Object.keys(expected)) {
			register(id, id);
		}
		run();
		const groupOf = groupByCommand();
		const actual = Object.fromEntries(Object.keys(expected).map(id => [id, groupOf.get(id)]));
		expect(actual).toEqual(expected);
		pick.cancel();
	});

	it('substitutes the picker label for every LABEL_OVERRIDES entry', () => {
		// Each registers under a title tuned for another surface; the picker
		// must show the fuller override label instead.
		const overrides: Record<string, string> = {
			'positronNotebook.addCodeCell': 'Add Code Cell',
			'positronNotebook.addMarkdownCell': 'Add Markdown Cell',
			'positronNotebook.cell.addTag': 'Add Cell Tag',
		};
		for (const id of Object.keys(overrides)) {
			register(id, 'Original Title'); // deliberately not the override text
		}
		run();
		const byId = new Map(items().map(i => [i.commandId, i.label]));
		const actual = Object.fromEntries(Object.keys(overrides).map(id => [id, byId.get(id)]));
		expect(actual).toEqual(overrides);
		pick.cancel();
	});

	it('sorts commands alphabetically within a group', () => {
		// Both land in the Run group. The group lists runAllCells before
		// executeSelectionInConsole, but the labels sort the other way ("E" <
		// "R"), so without the within-group sort they would come out in the
		// wrong order.
		registrations.add(MenuRegistry.addCommand({ id: 'positronNotebook.runAllCells', title: 'Run All Cells' }));
		registrations.add(MenuRegistry.appendMenuItem(MenuId.CommandPalette, { command: { id: 'positronNotebook.runAllCells', title: 'Run All Cells' } }));
		registrations.add(MenuRegistry.addCommand({ id: 'positronNotebook.executeSelectionInConsole', title: 'Execute Selection in Console' }));
		registrations.add(MenuRegistry.appendMenuItem(MenuId.CommandPalette, { command: { id: 'positronNotebook.executeSelectionInConsole', title: 'Execute Selection in Console' } }));
		run();
		const runGroup = items()
			.filter(i => i.commandId === 'positronNotebook.runAllCells' || i.commandId === 'positronNotebook.executeSelectionInConsole')
			.map(i => i.label);
		expect(runGroup).toEqual(['Execute Selection in Console', 'Run All Cells']);
		pick.cancel();
	});
});
