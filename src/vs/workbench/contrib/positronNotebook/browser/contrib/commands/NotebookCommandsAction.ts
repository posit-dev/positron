/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../../../nls.js';
import { Action2, isIMenuItem, MenuId, MenuRegistry, registerAction2 } from '../../../../../../platform/actions/common/actions.js';
import { Codicon } from '../../../../../../base/common/codicons.js';
import { DisposableStore } from '../../../../../../base/common/lifecycle.js';
import { ContextKeyExpr } from '../../../../../../platform/contextkey/common/contextkey.js';
import { ICommandService } from '../../../../../../platform/commands/common/commands.js';
import { ServicesAccessor } from '../../../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../../../platform/keybinding/common/keybinding.js';
import { IQuickInputService, IQuickPickItem } from '../../../../../../platform/quickinput/common/quickInput.js';
import { POSITRON_NOTEBOOK_EDITOR_ID } from '../../../common/positronNotebookCommon.js';

const SHOW_NOTEBOOK_COMMANDS_ACTION_ID = 'positronNotebook.showCommands';

/** Command id prefix that identifies Positron Notebook commands. */
const POSITRON_NOTEBOOK_COMMAND_PREFIX = 'positronNotebook.';

interface INotebookCommandPickItem extends IQuickPickItem {
	readonly commandId: string;
}

/**
 * Collect the command ids to show: every `positronNotebook.` command in the
 * command palette, minus this picker's own command.
 */
function collectNotebookCommandIds(): string[] {
	const ids = new Set<string>();
	for (const item of MenuRegistry.getMenuItems(MenuId.CommandPalette)) {
		if (isIMenuItem(item) && item.command.id.startsWith(POSITRON_NOTEBOOK_COMMAND_PREFIX)) {
			ids.add(item.command.id);
		}
	}
	// To surface commands the prefix scan misses (e.g. keybinding-only commands
	// absent from the command palette), add a greenlist of ids here before the
	// self-exclusion below. Only greenlist commands that actually run from the
	// Positron Notebook editor: upstream commands gated on `notebookEditorFocused`
	// won't run, because the editor sets `positronNotebookEditorFocused` instead.
	ids.delete(SHOW_NOTEBOOK_COMMANDS_ACTION_ID);
	return [...ids];
}

/**
 * Show a quick pick of Positron Notebook commands and run the selected one.
 * Exported so other entry points (e.g. a future customizations dropdown) can
 * reuse it.
 */
export function showNotebookCommandsQuickPick(
	quickInputService: IQuickInputService,
	commandService: ICommandService,
	keybindingService: IKeybindingService,
): void {
	const items: INotebookCommandPickItem[] = [];
	for (const commandId of collectNotebookCommandIds()) {
		const command = MenuRegistry.getCommand(commandId);
		if (!command) {
			continue;
		}
		const label = typeof command.title === 'string' ? command.title : command.title.value;
		items.push({
			commandId,
			label,
			keybinding: keybindingService.lookupKeybinding(commandId),
		});
	}
	items.sort((a, b) => a.label.localeCompare(b.label));

	const store = new DisposableStore();
	const quickPick = store.add(quickInputService.createQuickPick<INotebookCommandPickItem>());
	quickPick.placeholder = localize('positron.notebookCommands.placeholder', "Select a notebook command to run");
	quickPick.items = items;
	store.add(quickPick.onDidAccept(() => {
		const selected = quickPick.selectedItems[0];
		if (selected) {
			commandService.executeCommand(selected.commandId);
		}
		quickPick.hide();
	}));
	store.add(quickPick.onDidHide(() => store.dispose()));
	quickPick.show();
}

export class ShowNotebookCommandsAction extends Action2 {
	constructor() {
		super({
			id: SHOW_NOTEBOOK_COMMANDS_ACTION_ID,
			title: localize2('positron.notebookCommands.action', 'Show Notebook Commands'),
			tooltip: localize2('positron.notebookCommands.tooltip', 'Show Notebook Commands'),
			icon: Codicon.listFlat,
			f1: true,
			category: localize2('positronNotebook.category', 'Notebook'),
			menu: {
				id: MenuId.EditorActionsLeft,
				group: 'navigation',
				order: 56,
				when: ContextKeyExpr.equals('activeEditor', POSITRON_NOTEBOOK_EDITOR_ID)
			}
		});
	}

	override run(accessor: ServicesAccessor): void {
		showNotebookCommandsQuickPick(
			accessor.get(IQuickInputService),
			accessor.get(ICommandService),
			accessor.get(IKeybindingService),
		);
	}
}
registerAction2(ShowNotebookCommandsAction);
