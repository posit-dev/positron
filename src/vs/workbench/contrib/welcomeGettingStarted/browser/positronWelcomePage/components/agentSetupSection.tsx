/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './environmentHealthSection.css';

// React.
import { useId } from 'react';

// Other dependencies.
import { localize } from '../../../../../../nls.js';
import { useEventState } from '../../../../../../base/browser/ui/react/useEventState.js';
import { usePositronReactServicesContext } from '../../../../../../base/browser/positronReactRendererContext.js';
import { CONFIGURE_PROVIDERS_ACTION_ID } from '../../../../positronAssistant/common/positronAssistantCommands.js';
import { MCP_ENABLED_KEY } from '../../../../positronAssistant/common/positronAIConfigurationKeys.js';
import { IHealthItem, IHealthItemFix } from '../environmentHealth.js';
import { ASSISTANT_ENABLED_KEY, ASSISTANT_EXTENSION_ID, IAgentSetupState, WelcomeAgentSetup } from '../welcomeAgentSetup.js';
import { HealthItemRow } from './healthItemRow.js';

/** Where the Posit Assistant docs explain how to sign in to a model provider. */
const ASSISTANT_DOCS_URL = 'https://positron.posit.co/assistant-getting-started.html';

/**
 * AgentSetupSectionProps interface.
 */
export interface AgentSetupSectionProps {
	readonly agentSetup: WelcomeAgentSetup;
	/**
	 * The id of a heading outside the section that names it. When set, the
	 * section leaves out its own heading.
	 */
	readonly labelledBy?: string;
}

/**
 * AgentSetupSection component. Lists what the user has set up for AI agents
 * (Posit Assistant, a model provider, and Positron's MCP server), each with a
 * button that takes them to the next thing to do.
 * @param props An AgentSetupSectionProps that contains the component properties.
 * @returns The rendered component, or nothing when AI features are off.
 */
export const AgentSetupSection = ({ agentSetup, labelledBy }: AgentSetupSectionProps) => {
	const services = usePositronReactServicesContext();
	const ownTitleId = useId();
	const titleId = labelledBy ?? ownTitleId;
	const state = useEventState(agentSetup.onDidChange, () => agentSetup.state);

	if (!state.aiEnabled) {
		return null;
	}

	const runFix = (fix: IHealthItemFix) =>
		services.commandService.executeCommand(fix.commandId, ...(fix.args ?? []));

	return (
		<section aria-labelledby={titleId} className='positron-welcome-page-environment-setup positron-welcome-page-agent-setup'>
			{!labelledBy &&
				<div className='environment-health-header'>
					<h2 className='environment-health-header-title' id={titleId}>
						{localize('positron.welcome.agentSetupTitle', "AI setup")}
					</h2>
				</div>
			}
			<div className='environment-health-card'>
				<ul className='environment-health-item-list'>
					{getAgentSetupItems(state).map(item =>
						<HealthItemRow key={item.id} busy={false} item={item} onRunFix={runFix} />
					)}
				</ul>
			</div>
		</section>
	);
};

/**
 * Whether the user can chat with Posit Assistant: it is on and has a provider.
 * @param state The agent setup.
 * @returns True when nothing is left to set up for the chat.
 */
export function isAssistantReady(state: IAgentSetupState): boolean {
	return state.assistant === 'on' && state.providerSignedIn;
}

/**
 * Turns the agent setup into rows: one for Posit Assistant, one for the model
 * provider, and one for Positron's MCP server.
 * @param state The agent setup.
 * @returns The rows, in the order the user should work through them.
 */
export function getAgentSetupItems(state: IAgentSetupState): IHealthItem[] {
	const items: IHealthItem[] = [];

	switch (state.assistant) {
		case 'on':
			items.push({
				id: 'assistant',
				status: 'pass',
				summary: localize('positron.welcome.agentSetupAssistantOn', "Posit Assistant is installed"),
			});
			break;
		case 'off':
			items.push({
				id: 'assistant',
				status: 'warn',
				summary: localize('positron.welcome.agentSetupAssistantOff', "Posit Assistant is turned off"),
				fix: {
					commandId: 'workbench.action.openSettings',
					args: [ASSISTANT_ENABLED_KEY],
					label: localize('positron.welcome.agentSetupAssistantTurnOn', "Turn On"),
				},
			});
			break;
		case 'missing':
			items.push({
				id: 'assistant',
				status: 'warn',
				summary: localize('positron.welcome.agentSetupAssistantMissing', "Posit Assistant is not installed"),
				fix: {
					commandId: 'workbench.extensions.action.showExtensionsWithIds',
					args: [[ASSISTANT_EXTENSION_ID]],
					label: localize('positron.welcome.agentSetupAssistantInstall', "Install"),
				},
			});
			break;
	}

	if (state.assistant !== 'on') {
		// Providers are set up inside Posit Assistant, so this waits for the row above.
		items.push({
			id: 'provider',
			status: 'skipped',
			summary: localize('positron.welcome.agentSetupProviderWaiting', "Sign in to a model provider"),
			detail: localize('positron.welcome.agentSetupProviderWaitingDetail', "Available once Posit Assistant is installed and turned on."),
		});
	} else if (state.providerSignedIn) {
		items.push({
			id: 'provider',
			status: 'pass',
			summary: localize('positron.welcome.agentSetupProviderSignedIn', "A model provider is signed in"),
		});
	} else {
		items.push({
			id: 'provider',
			status: 'warn',
			summary: localize('positron.welcome.agentSetupProviderSignedOut', "No model provider is signed in"),
			detail: localize('positron.welcome.agentSetupProviderSignedOutDetail', "Sign in to Posit AI, Anthropic, OpenAI, or another provider to chat with Posit Assistant."),
			fix: {
				commandId: CONFIGURE_PROVIDERS_ACTION_ID,
				label: localize('positron.welcome.agentSetupProviderSignIn', "Sign In"),
			},
			learnMoreUrl: ASSISTANT_DOCS_URL,
		});
	}

	// Optional, so off is not a problem to fix.
	items.push(state.mcpServerEnabled
		? {
			id: 'mcp',
			status: 'pass',
			summary: localize('positron.welcome.agentSetupMcpOn', "Positron's MCP server is on"),
			detail: localize('positron.welcome.agentSetupMcpDetail', "Coding agents such as Claude Code can run code in your Python and R sessions."),
		}
		: {
			id: 'mcp',
			status: 'skipped',
			summary: localize('positron.welcome.agentSetupMcpOff', "Positron's MCP server is off"),
			detail: localize('positron.welcome.agentSetupMcpOffDetail', "Turn it on to let coding agents such as Claude Code run code in your Python and R sessions."),
			fix: {
				commandId: 'workbench.action.openSettings',
				args: [MCP_ENABLED_KEY],
				label: localize('positron.welcome.agentSetupMcpTurnOn', "Turn On"),
			},
		});

	return items;
}
