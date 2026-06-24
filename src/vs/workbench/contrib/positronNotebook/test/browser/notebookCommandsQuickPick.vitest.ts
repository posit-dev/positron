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
	const executeCommand = vi.fn();

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
		// A palette command under the positronNotebook. prefix -> auto-included.
		registrations.add(MenuRegistry.addCommand({ id: 'positronNotebook.testAuto', title: 'Test Auto Command' }));
		registrations.add(MenuRegistry.appendMenuItem(MenuId.CommandPalette, { command: { id: 'positronNotebook.testAuto', title: 'Test Auto Command' } }));
		// The greenlit command: registered but NOT in the command palette, so it
		// can only appear via the greenlist.
		registrations.add(MenuRegistry.addCommand({ id: 'positronNotebook.toggleLineNumbers', title: 'Toggle Line Numbers' }));
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

	function items(): ICommandPickItem[] {
		return pick.items.filter((i): i is ICommandPickItem => i.type !== 'separator');
	}

	it('lists prefixed palette commands and greenlit commands', () => {
		run();
		const ids = items().map(i => i.commandId);
		expect(ids).toContain('positronNotebook.testAuto');
		expect(ids).toContain('positronNotebook.toggleLineNumbers');
		pick.cancel(); // close the picker so its DisposableStore is released
	});

	it('runs the selected command on accept', () => {
		run();
		const item = items().find(i => i.commandId === 'positronNotebook.testAuto')!;
		pick.accept(item);
		expect(executeCommand).toHaveBeenCalledTimes(1);
		expect(executeCommand).toHaveBeenCalledWith('positronNotebook.testAuto');
	});
});
