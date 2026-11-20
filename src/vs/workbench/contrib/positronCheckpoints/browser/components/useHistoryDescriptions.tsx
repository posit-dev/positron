/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Descriptions are requested for the loaded rows, 3 at a time, because row visibility is not
// observed yet.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { ICheckpointsService } from '../../../../services/positronCheckpoints/common/checkpointsService.js';
import { ICheckpoint, ICheckpointsEngineProxy } from '../../../../services/positronCheckpoints/common/checkpointsTypes.js';
import { describeHistoryJob, IDescribeHistoryInput, IHistoryDescription, readHistoryDiff } from '../../common/agent/describeHistory.js';
import { ICheckpointsAgentService } from '../checkpointsAgentService.js';
import { ICheckpointsMessageService, reportReadFailure } from '../checkpointsMessages.js';
import { useAgentAvailable } from './useChangesDescription.js';

/** The most descriptions of history rows that are requested at the same time. */
export const MAX_CONCURRENT_HISTORY_DESCRIPTIONS = 3;

/**
 * The input of the "describe history" job for one checkpoint: the checkpoint and its changes as
 * text (`readHistoryDiff`). Without an engine, `diff` is empty. A failed read rejects.
 */
export async function historyDescriptionInput(engine: ICheckpointsEngineProxy | undefined, checkpoint: ICheckpoint): Promise<IDescribeHistoryInput> {
	return { checkpoint, diff: engine ? await readHistoryDiff(engine, checkpoint.id) : '' };
}

/**
 * Plain-language descriptions of the colleagues' checkpoints in `checkpoints`, by checkpoint id.
 * The rows of the loaded pages stand for the visible rows, because the `IntersectionObserver` of
 * the test environment (happy-dom) never reports. The rows are described in their order, at most
 * `MAX_CONCURRENT_HISTORY_DESCRIPTIONS` at a time, while `active` is true and the agent is
 * available. A row is requested once while the component lives; the agent's cache answers it
 * again after the view opens again. A row whose job fails keeps its original title.
 *
 * While the agent is not available the result is empty, so every row shows its original title.
 * Requests in progress are cancelled when the component goes away, the agent becomes unavailable,
 * or `active` becomes false; their rows are requested again later.
 */
export function useHistoryDescriptions(checkpoints: readonly ICheckpoint[], active: boolean): ReadonlyMap<string, IHistoryDescription> {
	const services = usePositronReactServicesContext();
	const available = useAgentAvailable();
	const [descriptions, setDescriptions] = useState<ReadonlyMap<string, IHistoryDescription>>(new Map());

	// The rows the requests read, and the ids whose job ended (with or without a description).
	const latestRows = useRef(checkpoints);
	useLayoutEffect(() => {
		latestRows.current = checkpoints;
	});
	const ended = useRef(new Set<string>());
	// Starts requests for the next rows. Set while requests may run.
	const startNext = useRef<() => void>(undefined);

	const enabled = active && available;
	useEffect(() => {
		if (!enabled) {
			return;
		}
		const source = new CancellationTokenSource();
		const running = new Set<string>();
		const agentService = services.get(ICheckpointsAgentService);

		const describe = async (checkpoint: ICheckpoint) => {
			try {
				let input: IDescribeHistoryInput;
				try {
					input = await historyDescriptionInput(services.get(ICheckpointsService).engine, checkpoint);
				} catch (error) {
					// The description is still asked for, from the message alone.
					if (!source.token.isCancellationRequested) {
						reportReadFailure(services.get(ILogService), services.get(ICheckpointsMessageService), 'The changes of a checkpoint could not be read for its description.', error);
					}
					input = { checkpoint, diff: '' };
				}
				if (source.token.isCancellationRequested) {
					return;
				}
				const outcome = await agentService.run(describeHistoryJob, input, source.token);
				if (source.token.isCancellationRequested) {
					return;
				}
				ended.current.add(checkpoint.id);
				if (outcome.ok) {
					setDescriptions(previous => new Map(previous).set(checkpoint.id, outcome.value));
				}
			} catch (error) {
				// A failed outcome: the row keeps its original title.
				ended.current.add(checkpoint.id);
				services.get(ILogService).error('A checkpoint could not be described.', error);
			} finally {
				running.delete(checkpoint.id);
				if (!source.token.isCancellationRequested) {
					next();
				}
			}
		};

		const next = () => {
			for (const checkpoint of latestRows.current) {
				if (running.size >= MAX_CONCURRENT_HISTORY_DESCRIPTIONS) {
					return;
				}
				if (checkpoint.authorIsMe || running.has(checkpoint.id) || ended.current.has(checkpoint.id)) {
					continue;
				}
				running.add(checkpoint.id);
				describe(checkpoint);
			}
		};

		startNext.current = next;
		next();
		return () => {
			startNext.current = undefined;
			source.dispose(true);
		};
	}, [services, enabled]);

	// New rows, such as an older page, start their requests when a place is free.
	useEffect(() => {
		startNext.current?.();
	}, [checkpoints]);

	return available ? descriptions : new Map();
}
