/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';
import { IHoverManager } from '../../../../../platform/hover/browser/hoverManager.js';
import { PositronActionBarHoverManager } from '../../../../../platform/positronActionBar/browser/positronActionBarHoverManager.js';
import { UNDO_LIMIT_DAYS, UNDO_LIMIT_OPERATIONS } from '../../common/checkpointsLimits.js';
import { Strings } from '../../common/checkpointsStrings.js';
import { ICheckpointsViewState } from './useCheckpointsState.js';
import { useRunAction } from './useRunAction.js';

/**
 * The number of files the person changed since the newest operation finished, or 0 when none
 * changed or the view has not seen the project right after that operation.
 *
 * The view keeps one baseline: the `changes.basis` it saw first for the current pair of undo and
 * redo entries, which is the first load after an operation finished. A new pair replaces the
 * baseline. When the current basis differs from it, every entry in `changes.files` counts,
 * because each differs from the last checkpoint.
 */
function useFilesChangedSince(view: ICheckpointsViewState): number {
	const state = view.state;
	const changes = view.changes;
	const pair = state ? `${state.undo?.operationId ?? ''}|${state.redo?.operationId ?? ''}` : undefined;
	const [baseline, setBaseline] = useState<{ pair: string; basis: string }>();

	useEffect(() => {
		if (pair === undefined || !changes) {
			return;
		}
		setBaseline(current => current?.pair === pair ? current : { pair, basis: changes.basis });
	}, [pair, changes]);

	if (!changes || baseline === undefined || baseline.pair !== pair) {
		return 0;
	}
	return baseline.basis === changes.basis ? 0 : changes.files.length;
}

/** A hover manager that lives as long as the component. */
function useHoverManager(): IHoverManager | undefined {
	const services = usePositronReactServicesContext();
	const [manager, setManager] = useState<IHoverManager>();
	useEffect(() => {
		const created = new PositronActionBarHoverManager(false, services.configurationService, services.hoverService);
		setManager(created);
		return () => created.dispose();
	}, [services]);
	return manager;
}

/**
 * Undo and Redo, each named by the action it applies to. They show only while their lists have an
 * entry. When Undo or Redo would set files back to how they were (the engine reports
 * `restoresFiles`), a note says how many files the person changed since the action. The hover text
 * states the limit of the undo list.
 */
export const UndoRedoBar = ({ view }: { view: ICheckpointsViewState }) => {
	const runAction = useRunAction();
	const hoverManager = useHoverManager();
	const changedSince = useFilesChangedSince(view);

	const state = view.state;
	if (!state || (!state.undo && !state.redo)) {
		return null;
	}
	const { undo, redo } = state;
	const restoresFiles = undo?.restoresFiles === true || redo?.restoresFiles === true;
	const tooltip = Strings.actions.undoHover(UNDO_LIMIT_OPERATIONS, UNDO_LIMIT_DAYS);

	const undoLast = async () => {
		if (undo) {
			await runAction('file-changing', (engine, { collisionChoices }) => engine.undo(undo.operationId, collisionChoices));
			view.refresh();
		}
	};
	const redoLast = async () => {
		if (redo) {
			await runAction('file-changing', (engine, { collisionChoices }) => engine.redo(redo.operationId, collisionChoices));
			view.refresh();
		}
	};

	return (
		<section aria-label={Strings.actions.undoLastAction()} className='checkpoints-section checkpoints-undo-redo'>
			{restoresFiles && changedSince > 0 && <p className='checkpoints-note'>{Strings.undoRedo.filesChangedSince(changedSince)}</p>}
			<div className='checkpoints-card-actions'>
				{undo && (
					<Button className='checkpoints-link' hoverManager={hoverManager} tooltip={tooltip} onPressed={undoLast}>
						{Strings.actions.undo(undo.description)}
					</Button>
				)}
				{redo && (
					<Button className='checkpoints-link' hoverManager={hoverManager} tooltip={tooltip} onPressed={redoLast}>
						{Strings.actions.redo(redo.description)}
					</Button>
				)}
			</div>
		</section>
	);
};
