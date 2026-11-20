/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';
import { CHECKPOINTS_SUGGESTIONS_ENABLED_KEY } from '../../common/checkpointsConfiguration.js';
import { Strings } from '../../common/checkpointsStrings.js';
import { ICheckpointsAgentService } from '../checkpointsAgentService.js';

/**
 * The one-time notice that changes are sent to the configured model provider (spec 7). It shows
 * while a job waits for it, in the view and never as a notification. OK lets the waiting jobs
 * continue, and Turn off suggestions turns the agent features off.
 */
export const DisclosureCard = () => {
	const services = usePositronReactServicesContext();
	const agentService = services.get(ICheckpointsAgentService);
	const [pending, setPending] = useState(agentService.pendingDisclosure);

	useEffect(() => {
		setPending(agentService.pendingDisclosure);
		const listener = agentService.onDidChangePendingDisclosure(() => setPending(agentService.pendingDisclosure));
		return () => listener.dispose();
	}, [agentService]);

	if (!pending) {
		return null;
	}

	return (
		<section aria-label={Strings.aiNotice.heading()} className='checkpoints-card'>
			<p>{Strings.aiNotice.disclosure()}</p>
			<div className='checkpoints-card-actions'>
				<Button className='checkpoints-button checkpoints-button-primary' onPressed={() => agentService.answerDisclosure('ok')}>
					{Strings.aiNotice.ok()}
				</Button>
				<Button className='checkpoints-button' onPressed={() => agentService.answerDisclosure('turn-off')}>
					{Strings.aiNotice.turnOff()}
				</Button>
				<Button
					className='checkpoints-link'
					onPressed={() => services.preferencesService.openSettings({ query: CHECKPOINTS_SUGGESTIONS_ENABLED_KEY })}
				>
					{Strings.aiNotice.openSetting()}
				</Button>
			</div>
		</section>
	);
};
