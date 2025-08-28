/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, DisposableStore } from '../../../../../../base/common/lifecycle.js';
import { ICommandMetadata, CommandsRegistry } from '../../../../../../platform/commands/common/commands.js';
import { ServicesAccessor } from '../../../../../../platform/instantiation/common/instantiation.js';
import { KeybindingsRegistry, KeybindingWeight } from '../../../../../../platform/keybinding/common/keybindingsRegistry.js';
import { POSITRON_NOTEBOOK_EDITOR_FOCUSED } from '../../../../../services/positronNotebook/browser/ContextKeysManager.js';
import { IPositronNotebookInstance } from '../../../../../services/positronNotebook/browser/IPositronNotebookInstance.js';
import { IPositronNotebookService } from '../../../../../services/positronNotebook/browser/positronNotebookService.js';
import { IPositronNotebookCommandKeybinding } from './commandUtils.js';

/**
 * Helper function to register a command that operates on the notebook instance.
 * Automatically handles getting the active notebook instance.
 * Optionally registers keybindings for the command.
 *
 * @param commandId The command ID to register
 * @param handler The function to execute with the active notebook instance
 * @param keybinding Optional keybinding configuration
 * @param metadata Optional command metadata including description, args, and return type
 * @returns Disposable to unregister both command and keybinding
 */

export function registerNotebookCommand({
	commandId, handler, keybinding, metadata
}: {
	commandId: string;
	handler: (notebook: IPositronNotebookInstance, accessor: ServicesAccessor) => void;
		keybinding?: IPositronNotebookCommandKeybinding;
	metadata?: ICommandMetadata;
}): IDisposable {
	const disposables = new DisposableStore();

	// Register the command
	const commandDisposable = CommandsRegistry.registerCommand({
		id: commandId,
		handler: (accessor: ServicesAccessor) => {
			const notebookService = accessor.get(IPositronNotebookService);
			const activeNotebook = notebookService.getActiveInstance();
			if (!activeNotebook) {
				return;
			}

			handler(activeNotebook, accessor);
		},
		metadata: metadata
	});
	disposables.add(commandDisposable);

	// Optionally register keybinding
	if (keybinding) {
		const keybindingDisposable = KeybindingsRegistry.registerKeybindingRule({
			id: commandId,
			weight: keybinding.weight ?? KeybindingWeight.EditorContrib,
			when: keybinding.when ?? POSITRON_NOTEBOOK_EDITOR_FOCUSED,
			primary: keybinding.primary,
			secondary: keybinding.secondary,
			mac: keybinding.mac,
			win: keybinding.win,
			linux: keybinding.linux
		});
		disposables.add(keybindingDisposable);
	}

	return disposables;
}
