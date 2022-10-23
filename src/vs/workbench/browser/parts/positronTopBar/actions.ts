/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import { Action } from 'vs/base/common/actions';
import { unmnemonicLabel } from 'vs/base/common/labels';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { ICommandsMap } from 'vs/platform/actions/common/actions';


export interface CommandActionContext {
	commands: ICommandsMap;
	commandService: ICommandService;
}

export function commandAction(id: string, label?: string, context?: CommandActionContext) {
	const command = context?.commands.get(id);
	if (command) {
		label = label || (typeof (command.title) === 'string' ? command.title : command.title.value);
		return new Action(command.id, unmnemonicLabel(label), undefined, undefined, () => {
			context?.commandService.executeCommand(command.id);
		});
	} else {
		return undefined;
	}
}
