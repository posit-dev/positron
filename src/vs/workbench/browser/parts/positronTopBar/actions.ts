/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import { Action } from 'vs/base/common/actions';
import { unmnemonicLabel } from 'vs/base/common/labels';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { CommandCenter } from 'vs/platform/commandCenter/common/commandCenter';

export interface CommandActionContext {
	commandService: ICommandService;
	contextKeyService: IContextKeyService;
}

export function commandAction(commandId: string, context: CommandActionContext, label?: string) {
	const commandInfo = CommandCenter.commandInfo(commandId);
	if (!commandInfo) {
		return undefined;
	}

	const enabled = !commandInfo.precondition || context.contextKeyService.contextMatchesRules(commandInfo.precondition);
	label = label || (typeof (commandInfo.title) === 'string' ? commandInfo.title : commandInfo.title.value);
	return new Action(commandId, unmnemonicLabel(label), undefined, enabled, () => {
		context?.commandService.executeCommand(commandId);
	});
}
