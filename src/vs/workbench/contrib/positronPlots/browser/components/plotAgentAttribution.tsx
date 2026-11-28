/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { IAgentAttribution } from '../../../../services/positronConsole/common/positronConsoleCodeExecution.js';

/**
 * Names the AI agent that ran the code that created a plot. When the agent can
 * reveal where it ran the code, such as a chat message, it is a button that
 * does so.
 */
export const PlotAgentAttribution = ({ agent }: { agent: IAgentAttribution }) => {
	const services = usePositronReactServicesContext();

	const content = <>
		<span aria-hidden='true' className='codicon codicon-sparkle' />
		{agent.name}
	</>;

	const revealCommand = agent.revealCommand;
	if (!revealCommand) {
		return <span className='plot-agent'>{content}</span>;
	}

	const label = localize('positron.plots.revealAgentExecution', "Show where {0} created this plot", agent.name);
	return (
		<button
			aria-label={label}
			className='plot-agent'
			title={label}
			onClick={() => services.commandService.executeCommand(revealCommand.command, ...(revealCommand.arguments ?? []))}
		>
			{content}
		</button>
	);
};
