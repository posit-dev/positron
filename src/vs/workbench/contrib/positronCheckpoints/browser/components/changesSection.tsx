/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';
import { ByteSize } from '../../../../../platform/files/common/files.js';
import { IChangedFile } from '../../../../services/positronCheckpoints/common/checkpointsTypes.js';
import { Strings } from '../../common/checkpointsStrings.js';
import { openDiff } from '../openDiff.js';
import { showCheckpointDialog } from './checkpointDialog.js';
import { knownSizes, statusWord } from './fileStatus.js';
import { SummaryText } from './summaryText.js';
import { ICheckpointsViewState } from './useCheckpointsState.js';
import { useChangesDescription } from './useChangesDescription.js';
import { useUnsavedCount } from './useUnsavedCount.js';

interface IChangesSectionProps {
	view: ICheckpointsViewState;
	/** True while the view is shown. The agent describes the changes only then. */
	visible: boolean;
}

/**
 * The Changes section: the files that differ from the last checkpoint with a plain status word
 * each, the count of files with unsaved edits that are not shown, the action that opens the
 * checkpoint dialog, and an icon button for the detailed differences of each file. While the
 * agent has a description of the changes, its summary shows above the files as a list and its
 * note under each file,
 * and the checkpoint dialog starts with its title and summary. Without one (while it loads, or
 * when the agent is off or gave no usable answer) the plain list shows, and the checkpoint
 * action never waits for it.
 */
export const ChangesSection = ({ view, visible }: IChangesSectionProps) => {
	const services = usePositronReactServicesContext();
	const unsavedCount = useUnsavedCount(view.state?.projectRoot ?? '');
	const description = useChangesDescription(view.changes, visible);

	const changes = view.changes;
	if (!changes) {
		return null;
	}

	const notes = new Map(description?.fileNotes.map(entry => [entry.path, entry.note]));
	const suggestedText = description && { title: description.title, body: description.summary };
	const create = () => showCheckpointDialog({ changes, suggestedText, onFinished: () => view.refresh() });
	const viewDifferences = (file: IChangedFile) => openDiff(services, { kind: 'change', path: file.path, oldPath: file.oldPath }, Strings.diff.changeTitle(file.path), knownSizes(file));

	return (
		<section aria-labelledby='checkpoints-changes-heading' className='checkpoints-section checkpoints-changes'>
			<h3 className='checkpoints-heading' id='checkpoints-changes-heading'>{Strings.changes.heading()}</h3>
			{unsavedCount > 0 && (
				<p className='checkpoints-note'>{Strings.changes.unsavedNote(unsavedCount)}</p>
			)}
			{description && description.summary !== '' && changes.files.length > 0 && (
				<SummaryText text={description.summary} />
			)}
			{changes.files.length === 0
				? <p>{Strings.changes.none()}</p>
				: (
					<ul className='checkpoints-file-list'>
						{changes.files.map(file => (
							<li key={file.path} className='checkpoints-file-row'>
								<div className='checkpoints-file-main'>
									<span className='checkpoints-file-path'>{file.path}</span>
									<span className={`checkpoints-file-status checkpoints-file-status-${file.status}`}>{statusWord(file)}</span>
									<Button
										ariaLabel={Strings.actions.viewDetailedDifferencesOf(file.path)}
										className='checkpoints-icon-button'
										tooltip={Strings.actions.viewDetailedDifferences()}
										onPressed={() => viewDifferences(file)}
									>
										<span aria-hidden='true' className='codicon codicon-diff' />
									</Button>
								</div>
								{file.oldPath !== undefined && (
									<span className='checkpoints-file-note'>{Strings.changes.previousName(file.oldPath)}</span>
								)}
								{file.binary && (
									<span className='checkpoints-file-note'>{Strings.changes.binaryFile(ByteSize.formatSize(file.sizeBytes))}</span>
								)}
								{notes.has(file.path) && (
									<span className='checkpoints-file-note'>{notes.get(file.path)}</span>
								)}
							</li>
						))}
					</ul>
				)}
			<Button className='checkpoints-button checkpoints-button-primary' disabled={changes.files.length === 0} onPressed={create}>
				{Strings.actions.createCheckpoint()}
			</Button>
		</section>
	);
};
