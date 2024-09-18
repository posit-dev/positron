/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CommandsRegistry } from 'vs/platform/commands/common/commands';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IChatUserActionEvent, ChatAgentVoteDirection, ChatCopyKind } from 'vs/workbench/contrib/chat/common/chatService';

type ChatVoteEvent = {
	direction: 'up' | 'down';
	agentId: string;
	command: string | undefined;
};

type ChatVoteClassification = {
	direction: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'Whether the user voted up or down.' };
	agentId: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The ID of the chat agent that this vote is for.' };
	command: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The name of the slash command that this vote is for.' };
	owner: 'roblourens';
	comment: 'Provides insight into the performance of Chat agents.';
};

type ChatCopyEvent = {
	copyKind: 'action' | 'toolbar';
	agentId: string;
	command: string | undefined;
};

type ChatCopyClassification = {
	copyKind: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'How the copy was initiated.' };
	agentId: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The ID of the chat agent that the copy acted on.' };
	command: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The name of the slash command the copy acted on.' };
	owner: 'roblourens';
	comment: 'Provides insight into the usage of Chat features.';
};

type ChatInsertEvent = {
	newFile: boolean;
	agentId: string;
	command: string | undefined;
};

type ChatInsertClassification = {
	newFile: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'Whether the code was inserted into a new untitled file.' };
	agentId: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The ID of the chat agent that this insertion is for.' };
	command: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The name of the slash command that this insertion is for.' };
	owner: 'roblourens';
	comment: 'Provides insight into the usage of Chat features.';
};

type ChatCommandEvent = {
	commandId: string;
	agentId: string;
	command: string | undefined;
};

type ChatCommandClassification = {
	commandId: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The id of the command that was executed.' };
	agentId: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The ID of the related chat agent.' };
	command: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The name of the related slash command.' };
	owner: 'roblourens';
	comment: 'Provides insight into the usage of Chat features.';
};

type ChatTerminalEvent = {
	languageId: string;
	agentId: string;
	command: string | undefined;
};

type ChatTerminalClassification = {
	languageId: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The language of the code that was run in the terminal.' };
	agentId: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The ID of the related chat agent.' };
	command: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'The name of the related slash command.' };
	owner: 'roblourens';
	comment: 'Provides insight into the usage of Chat features.';
};

export class ChatServiceTelemetry {
	constructor(
		@ITelemetryService private readonly telemetryService: ITelemetryService,
	) { }

	notifyUserAction(action: IChatUserActionEvent): void {
		if (action.action.kind === 'vote') {
			this.telemetryService.publicLog2<ChatVoteEvent, ChatVoteClassification>('interactiveSessionVote', {
				direction: action.action.direction === ChatAgentVoteDirection.Up ? 'up' : 'down',
				agentId: action.agentId ?? '',
				command: action.command,
			});
		} else if (action.action.kind === 'copy') {
			this.telemetryService.publicLog2<ChatCopyEvent, ChatCopyClassification>('interactiveSessionCopy', {
				copyKind: action.action.copyKind === ChatCopyKind.Action ? 'action' : 'toolbar',
				agentId: action.agentId ?? '',
				command: action.command,
			});
		} else if (action.action.kind === 'insert') {
			this.telemetryService.publicLog2<ChatInsertEvent, ChatInsertClassification>('interactiveSessionInsert', {
				newFile: !!action.action.newFile,
				agentId: action.agentId ?? '',
				command: action.command,
			});
		} else if (action.action.kind === 'command') {
			// TODO not currently called
			const command = CommandsRegistry.getCommand(action.action.commandButton.command.id);
			const commandId = command ? action.action.commandButton.command.id : 'INVALID';
			this.telemetryService.publicLog2<ChatCommandEvent, ChatCommandClassification>('interactiveSessionCommand', {
				commandId,
				agentId: action.agentId ?? '',
				command: action.command,
			});
		} else if (action.action.kind === 'runInTerminal') {
			this.telemetryService.publicLog2<ChatTerminalEvent, ChatTerminalClassification>('interactiveSessionRunInTerminal', {
				languageId: action.action.languageId ?? '',
				agentId: action.agentId ?? '',
				command: action.command,
			});
		}
	}
}
