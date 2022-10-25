/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import { Action } from 'vs/base/common/actions';
import { unmnemonicLabel } from 'vs/base/common/labels';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { ICommandsMap } from 'vs/platform/actions/common/actions';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';


export interface CommandActionContext {
	commands: ICommandsMap;
	commandService: ICommandService;
	contextKeyService: IContextKeyService;
}

export function commandAction(id: string, label?: string, context?: CommandActionContext) {
	const command = context?.commands.get(id);
	if (context && command) {
		const enabled = !command.precondition || context.contextKeyService.contextMatchesRules(command.precondition);
		label = label || (typeof (command.title) === 'string' ? command.title : command.title.value);
		return new Action(command.id, unmnemonicLabel(label), undefined, enabled, () => {
			context?.commandService.executeCommand(command.id);
		});
	} else {
		return undefined;
	}
}
