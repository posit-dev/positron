/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../../base/common/codicons.js';
import { KeyCode, KeyMod } from '../../../../../base/common/keyCodes.js';
import { ServicesAccessor } from '../../../../../editor/browser/editorExtensions.js';
import { localize, localize2 } from '../../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { KeybindingWeight } from '../../../../../platform/keybinding/common/keybindingsRegistry.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { ChatContextKeys } from '../../common/chatContextKeys.js';
import { IChatToolInvocation } from '../../common/chatService.js';
import { isResponseVM } from '../../common/chatViewModel.js';
import { ChatModeKind } from '../../common/constants.js';
import { IToolData, ToolSet } from '../../common/languageModelToolsService.js';
import { IChatWidget, IChatWidgetService } from '../chat.js';
import { ToolsScope } from '../chatSelectedTools.js';
import { CHAT_CATEGORY } from './chatActions.js';
import { showToolsPicker } from './chatToolPicker.js';


type SelectedToolData = {
	enabled: number;
	total: number;
};
type SelectedToolClassification = {
	owner: 'connor4312';
	comment: 'Details the capabilities of the MCP server';
	enabled: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'Number of enabled chat tools' };
	total: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'Number of total chat tools' };
};

export const AcceptToolConfirmationActionId = 'workbench.action.chat.acceptTool';

class AcceptToolConfirmation extends Action2 {
	constructor() {
		super({
			id: AcceptToolConfirmationActionId,
			title: localize2('chat.accept', "Accept"),
			f1: false,
			category: CHAT_CATEGORY,
			keybinding: {
				when: ContextKeyExpr.and(ChatContextKeys.inChatSession, ChatContextKeys.Editing.hasToolConfirmation),
				primary: KeyMod.CtrlCmd | KeyCode.Enter,
				// Override chatEditor.action.accept
				weight: KeybindingWeight.WorkbenchContrib + 1,
			},
		});
	}

	run(accessor: ServicesAccessor, ...args: any[]) {
		const chatWidgetService = accessor.get(IChatWidgetService);
		const widget = chatWidgetService.lastFocusedWidget;
		const lastItem = widget?.viewModel?.getItems().at(-1);
		if (!isResponseVM(lastItem)) {
			return;
		}

		const unconfirmedToolInvocation = lastItem.model.response.value.find((item): item is IChatToolInvocation => item.kind === 'toolInvocation' && !item.isConfirmed);
		if (unconfirmedToolInvocation) {
			unconfirmedToolInvocation.confirmed.complete(true);
		}

		// Return focus to the chat input, in case it was in the tool confirmation editor
		widget?.focusInput();
	}
}

class ConfigureToolsAction extends Action2 {

	constructor() {
		super({
			id: 'workbench.action.chat.configureTools',
			title: localize('label', "Configure Tools..."),
			icon: Codicon.tools,
			f1: false,
			category: CHAT_CATEGORY,
			precondition: ChatContextKeys.chatModeKind.isEqualTo(ChatModeKind.Agent),
			menu: [{
				when: ChatContextKeys.chatModeKind.isEqualTo(ChatModeKind.Agent),
				id: MenuId.ChatExecute,
				group: 'navigation',
				order: 1,
			}]
		});
	}

	override async run(accessor: ServicesAccessor, ...args: any[]): Promise<void> {

		const instaService = accessor.get(IInstantiationService);
		const chatWidgetService = accessor.get(IChatWidgetService);
		const telemetryService = accessor.get(ITelemetryService);

		let widget = chatWidgetService.lastFocusedWidget;
		if (!widget) {
			type ChatActionContext = { widget: IChatWidget };
			function isChatActionContext(obj: any): obj is ChatActionContext {
				return obj && typeof obj === 'object' && (obj as ChatActionContext).widget;
			}
			const context = args[0];
			if (isChatActionContext(context)) {
				widget = context.widget;
			}
		}

		if (!widget) {
			return;
		}

		let placeholder;
		let description;
		const { entriesScope, entriesMap } = widget.input.selectedToolsModel;
		switch (entriesScope) {
			case ToolsScope.Session:
				placeholder = localize('chat.tools.placeholder.session', "Select tools for this chat session");
				description = localize('chat.tools.description.session', "The selected tools were configured by a prompt command and only apply to this chat session.");
				break;
			case ToolsScope.Mode:
				placeholder = localize('chat.tools.placeholder.mode', "Select tools for this chat mode");
				description = localize('chat.tools.description.mode', "The selected tools are configured by the '{0}' chat mode. Changes to the tools will be applied to the mode file as well.", widget.input.currentModeObs.get().name);
				break;
			case ToolsScope.Global:
				placeholder = localize('chat.tools.placeholder.global', "Select tools that are available to chat.");
				description = undefined;
				break;
		}

		const result = await instaService.invokeFunction(showToolsPicker, placeholder, description, entriesMap.get(), newEntriesMap => {
			const disableToolSets: ToolSet[] = [];
			const disableTools: IToolData[] = [];
			for (const [item, enabled] of newEntriesMap) {
				if (!enabled) {
					if (item instanceof ToolSet) {
						disableToolSets.push(item);
					} else {
						disableTools.push(item);
					}
				}
			}
		});
		if (result) {
			widget.input.selectedToolsModel.set(result, false);
		}

		telemetryService.publicLog2<SelectedToolData, SelectedToolClassification>('chat/selectedTools', {
			total: widget.input.selectedToolsModel.entriesMap.get().size,
			enabled: widget.input.selectedToolsModel.entries.get().size,
		});
	}
}

export function registerChatToolActions() {
	registerAction2(AcceptToolConfirmation);
	registerAction2(ConfigureToolsAction);
}
