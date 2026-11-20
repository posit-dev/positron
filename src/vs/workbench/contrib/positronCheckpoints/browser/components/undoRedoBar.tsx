/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useRef, useState } from 'react';
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
 * The view saves `changes.basis` the first time it sees a pair of undo and redo entries, which is
 * the first load after an operation finished. When the current basis differs, every entry in
 * `changes.files` counts, because each differs from the last checkpoint.
 */
function useFilesChangedSince(view: ICheckpointsViewState): number {
	const bases = useRef(new Map<string, string>());
	const state = view.state;
	const changes = view.changes;
	if (!state || !changes) {
		return 0;
	}
	const key = `${state.undo?.operationId ?? ''}|${state.redo?.operationId ?? ''}`;
	if (!bases.current.has(key)) {
		bases.current.set(key, changes.basis);
	}
	return bases.current.get(key) === changes.basis ? 0 : changes.files.length;
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
 * entry. Before a file-changing Undo or Redo, a note says how many files the person changed since
 * the action. The hover text states the limit of the undo list.
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
			{changedSince > 0 && <p className='checkpoints-note'>{Strings.undoRedo.filesChangedSince(changedSince)}</p>}
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
