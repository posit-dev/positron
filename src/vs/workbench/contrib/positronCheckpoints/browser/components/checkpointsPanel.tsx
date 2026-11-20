/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import '../media/positronCheckpoints.css';

import { ChangesSection } from './changesSection.js';
import { HistorySection } from './historySection.js';
import { StatusHeader } from './statusHeader.js';
import { SyncCard } from './syncCard.js';
import { useCheckpointsState } from './useCheckpointsState.js';
import { useCheckpointsMessage } from './useRunAction.js';

/**
 * The content of the Checkpoints view: the status header, the status line of the last action,
 * and the sections of a tracked project. In an unusual state the sections are disabled.
 */
export const CheckpointsPanel = () => {
	const view = useCheckpointsState();
	const message = useCheckpointsMessage();

	const state = view.state;
	const tracking = state?.tracking === 'tracking';
	const actionsEnabled = tracking && state.unusual === undefined;

	return (
		<div className='positron-checkpoints'>
			<StatusHeader view={view} />
			<div aria-live='polite' className='checkpoints-message' role='status'>
				{message}
			</div>
			{tracking && (
				// A disabled fieldset disables every control inside it.
				<fieldset className='checkpoints-sections' data-testid='checkpoints-sections' disabled={!actionsEnabled}>
					<SyncCard view={view} />
					<ChangesSection view={view} />
					<HistorySection view={view} />
					{/* Section slot: kept files */}
					{/* Section slot: undo and redo */}
				</fieldset>
			)}
		</div>
	);
};
