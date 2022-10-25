/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import { ILocalizedString } from 'vs/platform/action/common/action';
import { ContextKeyExpression } from 'vs/platform/contextkey/common/contextkey';

interface ICommandInfo {
	id: string;
	title: string | ILocalizedString;
	precondition?: ContextKeyExpression;
}

export interface ICommandCenter {
	addCommandInfo(commandInfo: ICommandInfo): void;
	title(id: string): string | undefined;
}

export const CommandCenter: ICommandCenter = new class implements ICommandCenter {

	private readonly commandInfos = new Map<string, ICommandInfo>();

	addCommandInfo(commandInfo: ICommandInfo): void {
		this.commandInfos.set(commandInfo.id, commandInfo);
	}

	title(id: string): string | undefined {
		const commandInfo = this.commandInfos.get(id);
		if (!commandInfo) {
			return undefined;
		}

		return typeof (commandInfo.title) === 'string' ? commandInfo.title : commandInfo.title.value;
	}
};
