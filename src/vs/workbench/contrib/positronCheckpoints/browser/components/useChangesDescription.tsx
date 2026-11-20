/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useRef, useState } from 'react';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { IChangeSet } from '../../../../services/positronCheckpoints/common/checkpointsTypes.js';
import { describeChangesJob, IChangesDescription } from '../../common/agent/describeChanges.js';
import { ICheckpointsAgentService } from '../checkpointsAgentService.js';

/** `ICheckpointsAgentService.available`, updated when it changes. */
export function useAgentAvailable(): boolean {
	const services = usePositronReactServicesContext();
	const agentService = services.get(ICheckpointsAgentService);
	const [available, setAvailable] = useState(agentService.available);

	useEffect(() => {
		setAvailable(agentService.available);
		const listener = agentService.onDidChangeAvailable(() => setAvailable(agentService.available));
		return () => listener.dispose();
	}, [agentService]);

	return available;
}

/**
 * The description of `changes` by the agent, or undefined while there is none: while it loads,
 * when the agent is not available, when the job gave no output, or when `active` is false. It is
 * requested while `active` is true, the agent is available, and there are changes, and requested
 * again when the basis of the changes differs, with the earlier request cancelled.
 */
export function useChangesDescription(changes: IChangeSet | undefined, active: boolean): IChangesDescription | undefined {
	const services = usePositronReactServicesContext();
	const agentService = services.get(ICheckpointsAgentService);
	const available = useAgentAvailable();
	const [described, setDescribed] = useState<{ basis: string; description: IChangesDescription }>();

	// The request reads the latest changes; a new object with the same basis is the same changes.
	const latestChanges = useRef(changes);
	latestChanges.current = changes;
	const basis = changes && changes.files.length > 0 ? changes.basis : undefined;

	useEffect(() => {
		const requested = latestChanges.current;
		if (!active || !available || basis === undefined || !requested) {
			return;
		}
		const source = new CancellationTokenSource();
		agentService.run(describeChangesJob, requested, source.token).then(outcome => {
			if (outcome.ok && !source.token.isCancellationRequested) {
				setDescribed({ basis, description: outcome.value });
			}
		});
		return () => source.dispose(true);
	}, [agentService, active, available, basis]);

	return active && available && described && described.basis === basis ? described.description : undefined;
}
