/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './checkpointDialog.css';

// React.
import { useEffect, useState } from 'react';

// Other dependencies.
import { PositronModalReactRenderer } from '../../../../../base/browser/positronModalReactRenderer.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { OKModalDialog } from '../../../../browser/positronComponents/positronModalDialog/positronOKModalDialog.js';
import { ICheckpointsService } from '../../../../services/positronCheckpoints/common/checkpointsService.js';
import { IChangedFile, OperationResult } from '../../../../services/positronCheckpoints/common/checkpointsTypes.js';
import { Strings } from '../../common/checkpointsStrings.js';
import { ICheckpointsMessageService, reportReadFailure } from '../checkpointsMessages.js';
import { openDiff } from '../openDiff.js';
import { IDialogActions } from './dialogActions.js';
import { statusWord } from './fileStatus.js';

const CHECK_RESULT_DIALOG_WIDTH = 560;
const CHECK_RESULT_DIALOG_HEIGHT = 440;

/** The two results that a project check produces. */
export type CheckResult = Extract<OperationResult, { kind: 'check-failed' | 'check-changed-checkpoint' }>;

/**
 * Opens the dialog for a project check result (spec 6.1). A check that did not pass shows what
 * happened, and a check that changed the checkpoint asks the person to accept or decline it.
 * Closing the dialog without deciding leaves the decision open in the view.
 *
 * @param chunkCount The number of checkpoints the request asked for. With more than one, the
 * dialog says which checkpoint was not created.
 */
export function showCheckResultDialog(result: CheckResult, actions: IDialogActions, chunkCount?: number): void {
	const renderer = new PositronModalReactRenderer();
	renderer.render(<CheckResultDialog actions={actions} chunkCount={chunkCount} renderer={renderer} result={result} />);
}

interface ICheckResultDialogProps {
	actions: IDialogActions;
	chunkCount?: number;
	renderer: PositronModalReactRenderer;
	result: CheckResult;
}

/**
 * The files of the pending approval `token` that differ from the approved checkpoint, read from
 * the engine. Undefined while they load, and when they could not be read (the could-not-load
 * sentence then shows on the status line of the view).
 */
function usePendingFiles(token: string | undefined): IChangedFile[] | undefined {
	const services = usePositronReactServicesContext();
	const [loaded, setLoaded] = useState<{ token: string; files: IChangedFile[] }>();

	useEffect(() => {
		const engine = services.get(ICheckpointsService).engine;
		if (token === undefined || !engine) {
			return;
		}
		let current = true;
		engine.getPendingFiles(token).then(
			files => {
				if (current) {
					setLoaded({ token, files });
				}
			},
			error => {
				if (current) {
					reportReadFailure(services.get(ILogService), services.get(ICheckpointsMessageService), 'The files of a pending checkpoint could not be read.', error);
				}
			}
		);
		return () => { current = false; };
	}, [services, token]);

	return loaded !== undefined && loaded.token === token ? loaded.files : undefined;
}

const CheckResultDialog = ({ actions, chunkCount, renderer, result }: ICheckResultDialogProps) => {
	const services = usePositronReactServicesContext();
	const [detailsShown, setDetailsShown] = useState(false);
	const pendingFiles = usePendingFiles(result.kind === 'check-changed-checkpoint' ? result.token : undefined);
	// Until the engine lists the files, the paths of the result stand in for them, without a status word.
	const changedFiles: { path: string; status?: string }[] = pendingFiles?.map(file => ({ path: file.path, status: statusWord(file) }))
		?? (result.kind === 'check-changed-checkpoint' ? result.changedPaths.map(path => ({ path })) : []);
	const chunkSentence = result.chunkIndex !== undefined && chunkCount !== undefined && chunkCount > 1
		? Strings.checkResult.chunkNotCreated(result.chunkIndex + 1, chunkCount)
		: undefined;

	const decide = async (accept: boolean) => {
		if (result.kind !== 'check-changed-checkpoint') {
			return;
		}
		renderer.dispose();
		await actions.run('no-guard', engine => accept ? engine.acceptCheckedCheckpoint(result.token) : engine.declineCheckedCheckpoint(result.token));
	};

	return (
		<OKModalDialog
			height={CHECK_RESULT_DIALOG_HEIGHT}
			okButtonTitle={Strings.actions.close()}
			renderer={renderer}
			title={result.kind === 'check-failed' ? Strings.checkResult.failedTitle() : Strings.checkResult.changedTitle()}
			width={CHECK_RESULT_DIALOG_WIDTH}
			onAccept={() => renderer.dispose()}
			onCancel={() => renderer.dispose()}
		>
			<div className='checkpoint-dialog'>
				{chunkSentence !== undefined && <p>{chunkSentence}</p>}
				{result.kind === 'check-failed' ? (
					<>
						<p>{Strings.results.forOperation(result)}</p>
						<FileList heading={Strings.checkResult.editedFiles()} paths={result.hookEditedFiles} />
						<Button ariaExpanded={detailsShown} className='checkpoints-link' onPressed={() => setDetailsShown(!detailsShown)}>
							{Strings.actions.showGitDetails()}
						</Button>
						{detailsShown && (
							<section aria-label={Strings.gitDetails.hookOutput()} className='checkpoints-git-details'>
								<pre>{result.output}</pre>
							</section>
						)}
					</>
				) : (
					<>
						<p>{Strings.results.forOperation(result)}</p>
						{changedFiles.length > 0 && (
							<>
								<p>{Strings.checkResult.changedFiles()}</p>
								<ul aria-label={Strings.checkResult.changedFiles()} className='checkpoint-dialog-files'>
									{changedFiles.map(({ path, status }) => (
										<li key={path} className='checkpoint-dialog-file-row'>
											<span>{path}</span>
											{status !== undefined && <span className='checkpoints-file-status'>{status}</span>}
											<Button
												ariaLabel={Strings.actions.viewDetailedDifferencesOf(path)}
												className='checkpoints-link'
												onPressed={() => openDiff(services, { kind: 'pending', token: result.token, path }, Strings.diff.pendingTitle(path))}
											>
												{Strings.actions.viewDetailedDifferences()}
											</Button>
										</li>
									))}
								</ul>
								<p className='checkpoints-note'>{Strings.checkResult.comparisonOpensLater()}</p>
							</>
						)}
						{result.hookEditedFiles.length > 0 && <p>{Strings.checkResult.filesChangedOnDisk(result.hookEditedFiles.length)}</p>}
						<div className='checkpoint-dialog-choice'>
							<Button className='checkpoints-button' onPressed={() => decide(true)}>
								{Strings.actions.acceptCheckedCheckpoint()}
							</Button>
							<Button className='checkpoints-button' onPressed={() => decide(false)}>
								{Strings.actions.declineCheckedCheckpoint()}
							</Button>
						</div>
					</>
				)}
			</div>
		</OKModalDialog>
	);
};

/** A heading and a list of paths, or nothing when there are none. */
const FileList = ({ heading, paths }: { heading: string; paths: string[] }) => {
	if (paths.length === 0) {
		return null;
	}
	return (
		<>
			<p>{heading}</p>
			<ul aria-label={heading} className='checkpoint-dialog-files'>
				{paths.map(path => <li key={path}>{path}</li>)}
			</ul>
		</>
	);
};
