/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IQuickInputService, IQuickPickItem, IQuickPickSeparator } from '../../../../platform/quickinput/common/quickInput.js';
import { IErrorActionsService, IRegisteredErrorActionHandler, POSIT_ASSISTANT_ERROR_ACTIONS_ID } from '../common/errorActions.js';
import { AI_ENABLED_KEY } from '../common/positronAIConfiguration.js';

/** A registered implementation in the agent picker. */
interface IAgentPickItem extends IQuickPickItem {
	readonly id: string;
}

/**
 * Build the agent picker's items: Posit Assistant, then the other registered
 * implementations below a separator. Each is marked when it is selected or
 * can't take errors, with its problem, if any, below it.
 */
export function getAgentPickItems(registered: readonly IRegisteredErrorActionHandler[], selectedId: string): (IAgentPickItem | IQuickPickSeparator)[] {
	const toItem = ({ handler, isEnabled, problem }: IRegisteredErrorActionHandler): IAgentPickItem => ({
		id: handler.id,
		label: handler.label,
		description: [
			handler.id === selectedId && localize('positron.errorActions.selectAgent.selected', "Selected"),
			!isEnabled && localize('positron.errorActions.selectAgent.unavailable', "Unavailable"),
		].filter(Boolean).join(', ') || undefined,
		detail: problem && `$(warning) ${problem}`,
	});
	const positAssistant = registered.filter(({ handler }) => handler.id === POSIT_ASSISTANT_ERROR_ACTIONS_ID);
	const others = registered.filter(({ handler }) => handler.id !== POSIT_ASSISTANT_ERROR_ACTIONS_ID);
	return [
		...positAssistant.map(toItem),
		...(positAssistant.length > 0 && others.length > 0 ? [{ type: 'separator' } as const] : []),
		...others.map(toItem),
	];
}

/** Pick the agent the error Fix and Explain actions send errors to. */
export class SelectErrorActionsAgentAction extends Action2 {
	static readonly ID = 'positron.errorActions.selectAgent';

	constructor() {
		super({
			id: SelectErrorActionsAgentAction.ID,
			title: localize2('positron.errorActions.selectAgent', "Select Agent for Fix/Explain"),
			category: localize2('positron.ai.category', "AI"),
			f1: true,
			precondition: ContextKeyExpr.has(`config.${AI_ENABLED_KEY}`),
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const errorActionsService = accessor.get(IErrorActionsService);
		const quickInputService = accessor.get(IQuickInputService);

		const items = getAgentPickItems(errorActionsService.getRegistered(), errorActionsService.selectedId);
		const picked = await quickInputService.pick(items, {
			placeHolder: localize('positron.errorActions.selectAgent.placeholder', "Select the agent that fixes and explains errors"),
			activeItem: items.find((item): item is IAgentPickItem => item.type !== 'separator' && item.id === errorActionsService.selectedId),
		});
		if (picked) {
			errorActionsService.select(picked.id);
		}
	}
}

registerAction2(SelectErrorActionsAgentAction);
