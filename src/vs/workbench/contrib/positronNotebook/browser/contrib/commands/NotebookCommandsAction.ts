/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../../../nls.js';
import { Action2, isIMenuItem, MenuId, MenuRegistry, registerAction2 } from '../../../../../../platform/actions/common/actions.js';
import { DisposableStore } from '../../../../../../base/common/lifecycle.js';
import { onUnexpectedError } from '../../../../../../base/common/errors.js';
import { ICommandService } from '../../../../../../platform/commands/common/commands.js';
import { IContextKeyService } from '../../../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../../../platform/keybinding/common/keybinding.js';
import { IQuickInputService, IQuickPickItem, QuickPickInput } from '../../../../../../platform/quickinput/common/quickInput.js';

export const SHOW_NOTEBOOK_COMMANDS_ACTION_ID = 'positronNotebook.showCommands';

/** Command id prefix that identifies Positron Notebook commands. */
const POSITRON_NOTEBOOK_COMMAND_PREFIX = 'positronNotebook.';

/**
 * Picker-only label overrides. A few commands carry a title tuned for another
 * surface -- e.g. toolbar buttons sitting next to an icon ("Code", "Markdown")
 * or a cell submenu ("Add Tag") where the context is implied. Flattened into
 * this text-only list that context is gone, so we substitute a fuller label
 * here without disturbing the command's registered title elsewhere.
 */
const LABEL_OVERRIDES: Record<string, string> = {
	'positronNotebook.addCodeCell': localize('positron.notebookCommands.addCodeCell', "Add Code Cell"),
	'positronNotebook.addMarkdownCell': localize('positron.notebookCommands.addMarkdownCell', "Add Markdown Cell"),
	'positronNotebook.cell.addTag': localize('positron.notebookCommands.addCellTag', "Add Cell Tag"),
};

interface ICommandGroup {
	readonly label: string;
	readonly ids: readonly string[];
}

/**
 * Ordered groups for the picker. A command lands in the first group that lists
 * it; anything unlisted -- including extension-contributed commands (e.g.
 * `positronNotebook.export`) and newly-added ones -- falls into a trailing
 * "Other" group, so the picker never silently drops a command.
 */
const COMMAND_GROUPS: readonly ICommandGroup[] = [
	{
		label: localize('positron.notebookCommands.group.run', "Run"),
		ids: ['positronNotebook.runAllCells', 'positronNotebook.stopAllCells', 'positronNotebook.cell.executeSelection', 'positronNotebook.executeSelectionInConsole'],
	},
	{
		label: localize('positron.notebookCommands.group.cells', "Cells"),
		ids: ['positronNotebook.addCodeCell', 'positronNotebook.addMarkdownCell', 'positronNotebook.cell.addTag', 'positronNotebook.removeAllCellTags', 'positronNotebook.toggleCellTags'],
	},
	{
		label: localize('positron.notebookCommands.group.outputs', "Outputs"),
		ids: ['positronNotebook.clearAllOutputs'],
	},
	{
		label: localize('positron.notebookCommands.group.kernel', "Kernel"),
		ids: ['positronNotebook.selectKernel'],
	},
	{
		label: localize('positron.notebookCommands.group.view', "View"),
		ids: ['positronNotebook.toggleOutline', 'positronNotebook.showConsole'],
	},
	{
		label: localize('positron.notebookCommands.group.assistant', "Assistant"),
		ids: ['positronNotebook.askAssistant', 'positronNotebook.enableGhostCellSuggestionsForNotebook', 'positronNotebook.showGhostCellInfo'],
	},
];

const OTHER_GROUP_LABEL = localize('positron.notebookCommands.group.other', "Other");

interface INotebookCommandPickItem extends IQuickPickItem {
	readonly commandId: string;
}

/**
 * Collect the command ids to show: every `positronNotebook.` command in the
 * command palette, minus this picker's own command. Commands are filtered by
 * their palette `when` clause so the picker never surfaces (or runs) a command
 * the palette itself would hide -- notably AI commands gated on `ai.enabled`,
 * whose CommandPalette `when` is the action's precondition.
 */
function collectNotebookCommandIds(contextKeyService: IContextKeyService): string[] {
	const ids = new Set<string>();
	for (const item of MenuRegistry.getMenuItems(MenuId.CommandPalette)) {
		if (isIMenuItem(item)
			&& item.command.id.startsWith(POSITRON_NOTEBOOK_COMMAND_PREFIX)
			&& contextKeyService.contextMatchesRules(item.when)) {
			ids.add(item.command.id);
		}
	}
	// Greenlist additional ids here (before this self-exclusion) if the prefix
	// scan ever needs to surface palette-absent commands.
	ids.delete(SHOW_NOTEBOOK_COMMANDS_ACTION_ID);
	return [...ids];
}

/**
 * Build the grouped picker items: resolve each collected command to a pick
 * item, then emit them under their group's separator in `COMMAND_GROUPS` order,
 * sorted by label within each group, with any leftovers under "Other".
 */
function buildNotebookCommandPickItems(keybindingService: IKeybindingService, contextKeyService: IContextKeyService): QuickPickInput<INotebookCommandPickItem>[] {
	const itemsById = new Map<string, INotebookCommandPickItem>();
	for (const commandId of collectNotebookCommandIds(contextKeyService)) {
		const command = MenuRegistry.getCommand(commandId);
		if (!command) {
			continue;
		}
		const label = LABEL_OVERRIDES[commandId]
			?? (typeof command.title === 'string' ? command.title : command.title.value);
		itemsById.set(commandId, { commandId, label, keybinding: keybindingService.lookupKeybinding(commandId) });
	}

	const result: QuickPickInput<INotebookCommandPickItem>[] = [];
	const emitGroup = (label: string, groupItems: INotebookCommandPickItem[]): void => {
		if (!groupItems.length) {
			return;
		}
		groupItems.sort((a, b) => a.label.localeCompare(b.label));
		result.push({ type: 'separator', label });
		result.push(...groupItems);
	};

	for (const group of COMMAND_GROUPS) {
		const groupItems: INotebookCommandPickItem[] = [];
		for (const id of group.ids) {
			const item = itemsById.get(id);
			if (item) {
				groupItems.push(item);
				itemsById.delete(id);
			}
		}
		emitGroup(group.label, groupItems);
	}
	emitGroup(OTHER_GROUP_LABEL, [...itemsById.values()]);
	return result;
}

/**
 * Show a quick pick of Positron Notebook commands and run the selected one.
 * Exported for testing.
 */
export function showNotebookCommandsQuickPick(
	quickInputService: IQuickInputService,
	commandService: ICommandService,
	keybindingService: IKeybindingService,
	contextKeyService: IContextKeyService,
): void {
	const store = new DisposableStore();
	const quickPick = store.add(quickInputService.createQuickPick<INotebookCommandPickItem>({ useSeparators: true }));
	// Keep our group order; the picker otherwise re-sorts items alphabetically.
	quickPick.sortByLabel = false;
	quickPick.placeholder = localize('positron.notebookCommands.placeholder', "Select a notebook command to run");
	quickPick.items = buildNotebookCommandPickItems(keybindingService, contextKeyService);
	store.add(quickPick.onDidAccept(() => {
		const selected = quickPick.selectedItems[0];
		if (selected) {
			commandService.executeCommand(selected.commandId).then(undefined, onUnexpectedError);
		}
		quickPick.hide();
	}));
	store.add(quickPick.onDidHide(() => store.dispose()));
	quickPick.show();
}

class ShowNotebookCommandsAction extends Action2 {
	constructor() {
		super({
			id: SHOW_NOTEBOOK_COMMANDS_ACTION_ID,
			title: localize2('positron.notebookCommands.action', 'Show Notebook Commands'),
			f1: true,
			category: localize2('positronNotebook.category', 'Notebook'),
			// No toolbar menu: this is surfaced from the notebook Help modal
			// ("Browse All Notebook Commands...") and the command palette, not a toolbar button.
		});
	}

	override run(accessor: ServicesAccessor): void {
		showNotebookCommandsQuickPick(
			accessor.get(IQuickInputService),
			accessor.get(ICommandService),
			accessor.get(IKeybindingService),
			accessor.get(IContextKeyService),
		);
	}
}
registerAction2(ShowNotebookCommandsAction);
