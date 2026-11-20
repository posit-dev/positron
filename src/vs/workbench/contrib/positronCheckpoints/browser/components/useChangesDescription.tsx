/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useRef, useState } from 'react';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { disposableTimeout } from '../../../../../base/common/async.js';
import { CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
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

/** How long the basis of the changes must stay the same before a changed basis is described. */
export const DESCRIBE_DELAY_MS = 3000;

/**
 * The description of `changes` by the agent, or undefined while there is none: while it loads,
 * when the agent is not available, when the job gave no output, or when `active` is false. It is
 * requested while `active` is true, the agent is available, and there are changes. When the basis
 * differs from the one last requested, the earlier request is cancelled and the new one is made
 * only after the basis stayed the same for `DESCRIBE_DELAY_MS`, so a burst of saves makes one
 * request.
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
	const lastRequestedBasis = useRef<string>(undefined);

	useEffect(() => {
		if (!active || !available || basis === undefined || !latestChanges.current) {
			return;
		}
		const source = new CancellationTokenSource();
		const request = () => {
			const requested = latestChanges.current;
			if (!requested) {
				return;
			}
			lastRequestedBasis.current = basis;
			agentService.run(describeChangesJob, requested, source.token).then(outcome => {
				if (outcome.ok && !source.token.isCancellationRequested) {
					setDescribed({ basis, description: outcome.value });
				}
			}, error => {
				// A failed outcome: the plain file list stays.
				services.get(ILogService).error('The changes could not be described.', error);
			});
		};
		const changed = lastRequestedBasis.current !== undefined && lastRequestedBasis.current !== basis;
		const timer = changed ? disposableTimeout(request, DESCRIBE_DELAY_MS) : undefined;
		if (!changed) {
			request();
		}
		return () => {
			timer?.dispose();
			source.dispose(true);
		};
	}, [services, agentService, active, available, basis]);

	return active && available && described && described.basis === basis ? described.description : undefined;
}
