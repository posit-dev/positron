/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useRef } from 'react';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';
import { Strings } from '../../common/checkpointsStrings.js';
import { ICheckpointsMessageService } from '../checkpointsMessages.js';
import { ICheckpointsViewState } from './useCheckpointsState.js';
import { showShareDialog } from './shareDialog.js';
import { showStartTrackingDialog } from './startTrackingDialog.js';

/** The command that opens the Source Control view. */
const OPEN_SOURCE_CONTROL_COMMAND_ID = 'workbench.view.scm';

/** The one status sentence of the view, and the action that goes with it. */
interface IStatus {
	sentence: string;
	action?: 'start' | 'share' | 'open-source-control';
}

/**
 * Chooses the status sentence. The first that applies wins: no engine, an unusual state, a plain
 * folder, an interrupted action, sync unavailable, no shared copy, behind, ahead, up to date. An
 * unusual state comes before a plain folder because a missing git program is reported for a
 * folder that is not a project, and starting would fail there.
 *
 * @returns The status, or undefined while the first load runs.
 */
export function describeStatus(view: ICheckpointsViewState): IStatus | undefined {
	if (!view.hasEngine) {
		return { sentence: Strings.status.noEngine() };
	}
	const state = view.state;
	if (!state) {
		return view.loading ? undefined : { sentence: Strings.status.couldNotRead() };
	}
	if (state.unusual) {
		return { sentence: Strings.status.unusual(state.unusual.kind), action: 'open-source-control' };
	}
	if (state.tracking === 'not-a-project') {
		return { sentence: Strings.status.notKeepingCheckpoints(), action: 'start' };
	}
	if (state.interrupted) {
		return { sentence: Strings.status.interrupted(state.interrupted.description) };
	}
	if (!state.syncAvailable) {
		return { sentence: Strings.status.syncUnavailable(state.requiredGitVersion) };
	}
	if (!state.shared.exists) {
		return { sentence: Strings.status.onlyOnThisComputer(), action: 'share' };
	}
	if (state.shared.behind > 0) {
		return { sentence: Strings.status.behind(state.shared.behind) };
	}
	if (state.shared.ahead > 0) {
		return { sentence: Strings.status.waitingToSend(state.shared.ahead) };
	}
	return { sentence: Strings.status.upToDate() };
}

/**
 * The status at the top of the Checkpoints view: the project the opened folder belongs to, when
 * it is a folder inside a project, and one status sentence with its action. The notice that an
 * interrupted action was finished at startup is published once on the status line of the view,
 * so a later load that still reports it does not replace the sentence of a later action.
 */
export const StatusHeader = ({ view }: { view: ICheckpointsViewState }) => {
	const services = usePositronReactServicesContext();

	const recoveryNotice = view.state?.recoveryNotice;
	const noticeShown = useRef(false);
	useEffect(() => {
		if (recoveryNotice !== undefined && !noticeShown.current) {
			noticeShown.current = true;
			services.get(ICheckpointsMessageService).show(Strings.status.recoveryNotice(recoveryNotice));
		}
	}, [services, recoveryNotice]);

	const status = describeStatus(view);
	const state = view.state;
	const showProjectName = state?.tracking === 'tracking' && state.openedFolderIsInsideProject;

	const start = () => {
		showStartTrackingDialog({ identityMissing: state?.identityMissing ?? false });
	};

	const share = () => {
		showShareDialog({ projectName: state?.projectName ?? '' });
	};

	const openSourceControl = () => {
		services.commandService.executeCommand(OPEN_SOURCE_CONTROL_COMMAND_ID);
	};

	return (
		<div className='checkpoints-status'>
			{showProjectName && (
				<p className='checkpoints-status-project'>{Strings.status.partOfProject(state.projectName)}</p>
			)}
			{status && (
				<p className='checkpoints-status-sentence'>{status.sentence}</p>
			)}
			{status?.action === 'start' && (
				<Button className='checkpoints-button checkpoints-button-primary' onPressed={start}>
					{Strings.actions.startKeepingCheckpoints()}
				</Button>
			)}
			{status?.action === 'share' && (
				<Button className='checkpoints-button checkpoints-button-primary' onPressed={share}>
					{Strings.share.action()}
				</Button>
			)}
			{status?.action === 'open-source-control' && (
				<Button className='checkpoints-link' onPressed={openSourceControl}>
					{Strings.actions.openSourceControl()}
				</Button>
			)}
		</div>
	);
};
