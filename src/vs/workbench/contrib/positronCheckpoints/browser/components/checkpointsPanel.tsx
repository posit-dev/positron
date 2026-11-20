/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import '../media/positronCheckpoints.css';

import { useEffect, useState } from 'react';
import { IReactComponentContainer } from '../../../../../base/browser/positronReactRenderer.js';
import { ChangesSection } from './changesSection.js';
import { DisclosureCard } from './disclosureCard.js';
import { HistorySection } from './historySection.js';
import { KeptFilesSection } from './keptFilesSection.js';
import { RecoverySnapshotsSection, StateCards } from './stateCards.js';
import { StatusHeader } from './statusHeader.js';
import { SuggestionCard } from './suggestionCard.js';
import { SyncCard } from './syncCard.js';
import { UndoRedoBar } from './undoRedoBar.js';
import { useCheckpointsState } from './useCheckpointsState.js';
import { useCheckpointsMessage } from './useRunAction.js';

/** True while `container` is shown. Without a container, the content counts as shown. */
function useContainerVisible(container: IReactComponentContainer | undefined): boolean {
	const [visible, setVisible] = useState(container?.containerVisible ?? true);

	useEffect(() => {
		if (!container) {
			return;
		}
		setVisible(container.containerVisible);
		const listener = container.onVisibilityChanged(shown => setVisible(shown));
		return () => listener.dispose();
	}, [container]);

	return visible;
}

/**
 * The content of the Checkpoints view: the status header, the status line of the last action,
 * the cards for open decisions and the notice about the model provider, and the sections of a
 * tracked project. In an unusual state the sections are disabled.
 *
 * @param container The view pane, which says whether the view is shown.
 */
export const CheckpointsPanel = ({ container }: { container?: IReactComponentContainer }) => {
	const view = useCheckpointsState();
	const message = useCheckpointsMessage();
	const visible = useContainerVisible(container);

	const state = view.state;
	const tracking = state?.tracking === 'tracking';
	const actionsEnabled = tracking && state.unusual === undefined;

	return (
		<div className='positron-checkpoints'>
			<StatusHeader view={view} />
			<div aria-live='polite' className='checkpoints-message' role='status'>
				{message}
			</div>
			{tracking && <StateCards view={view} />}
			{/* A job can wait for the notice in any state, so the notice shows in every state. */}
			<DisclosureCard />
			{tracking && (
				// A disabled fieldset disables every control inside it.
				<fieldset className='checkpoints-sections' data-testid='checkpoints-sections' disabled={!actionsEnabled}>
					<SyncCard view={view} />
					<SuggestionCard view={view} />
					<ChangesSection view={view} visible={visible} />
					<HistorySection view={view} />
					<KeptFilesSection view={view} />
					<RecoverySnapshotsSection view={view} />
					<UndoRedoBar view={view} />
				</fieldset>
			)}
		</div>
	);
};
