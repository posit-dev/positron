/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import { ILocalizedString } from 'vs/platform/action/common/action';
import { Action2 } from 'vs/platform/actions/common/actions';
import { ContextKeyExpression } from 'vs/platform/contextkey/common/contextkey';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';

export const ICommandCenterService = createDecorator<ICommandCenterService>('commandService');
export interface ICommandCenterService {
	yaya(): void;
}

export interface ICommandCenter {
	registerAction2(action2: Action2): void;
	title(id: string): string | undefined;
}

interface ICommandInfo {
	title: string | ILocalizedString;
	precondition?: ContextKeyExpression;
}

export const CommandCenter: ICommandCenter = new class implements ICommandCenter {

	private readonly actions = new Map<string, ICommandInfo>();

	registerAction2(action2: Action2): void {
		this.actions.set(action2.desc.id, {
			title: action2.desc.title,
			precondition: action2.desc.precondition
		});
	}

	title(id: string): string | undefined {
		const commandInfo = this.actions.get(id);
		if (!commandInfo) {
			return undefined;
		}

		return typeof (commandInfo.title) === 'string' ? commandInfo.title : commandInfo.title.value;
	}
};
