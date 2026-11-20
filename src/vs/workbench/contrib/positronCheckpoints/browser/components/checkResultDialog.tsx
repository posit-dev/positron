/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './checkpointDialog.css';

// React.
import { useState } from 'react';

// Other dependencies.
import { PositronModalReactRenderer } from '../../../../../base/browser/positronModalReactRenderer.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';
import { OKModalDialog } from '../../../../browser/positronComponents/positronModalDialog/positronOKModalDialog.js';
import { OperationResult } from '../../../../services/positronCheckpoints/common/checkpointsTypes.js';
import { Strings } from '../../common/checkpointsStrings.js';
import { openDiff } from '../openDiff.js';
import { IDialogActions } from './dialogActions.js';

const CHECK_RESULT_DIALOG_WIDTH = 560;
const CHECK_RESULT_DIALOG_HEIGHT = 440;

/** The two results that a project check produces. */
export type CheckResult = Extract<OperationResult, { kind: 'check-failed' | 'check-changed-checkpoint' }>;

/**
 * Opens the dialog for a project check result (spec 6.1). A check that did not pass shows what
 * happened, and a check that changed the checkpoint asks the person to accept or decline it.
 * Closing the dialog without deciding leaves the decision open in the view.
 */
export function showCheckResultDialog(result: CheckResult, actions: IDialogActions): void {
	const renderer = new PositronModalReactRenderer();
	renderer.render(<CheckResultDialog actions={actions} renderer={renderer} result={result} />);
}

interface ICheckResultDialogProps {
	actions: IDialogActions;
	renderer: PositronModalReactRenderer;
	result: CheckResult;
}

const CheckResultDialog = ({ actions, renderer, result }: ICheckResultDialogProps) => {
	const services = usePositronReactServicesContext();
	const [detailsShown, setDetailsShown] = useState(false);

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
						{result.changedPaths.length > 0 && (
							<>
								<p>{Strings.checkResult.changedFiles()}</p>
								<ul aria-label={Strings.checkResult.changedFiles()} className='checkpoint-dialog-files'>
									{result.changedPaths.map(path => (
										<li key={path} className='checkpoint-dialog-file-row'>
											<span>{path}</span>
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
