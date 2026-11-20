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
import { statusWord } from './fileStatus.js';
import { ICheckpointsViewState } from './useCheckpointsState.js';
import { useUnsavedCount } from './useUnsavedCount.js';

/**
 * The Changes section: the files that differ from the last checkpoint with a plain status word
 * each, the count of files with unsaved edits that are not shown, the action that opens the
 * checkpoint dialog, and the detailed differences of each file.
 */
export const ChangesSection = ({ view }: { view: ICheckpointsViewState }) => {
	const services = usePositronReactServicesContext();
	const unsavedCount = useUnsavedCount(view.state?.projectRoot ?? '');

	const changes = view.changes;
	if (!changes) {
		return null;
	}

	const create = () => showCheckpointDialog({ changes, onFinished: () => view.refresh() });
	const viewDifferences = (file: IChangedFile) => openDiff(services, { kind: 'change', path: file.path }, Strings.diff.changeTitle(file.path));

	return (
		<section aria-labelledby='checkpoints-changes-heading' className='checkpoints-section checkpoints-changes'>
			<h3 className='checkpoints-heading' id='checkpoints-changes-heading'>{Strings.changes.heading()}</h3>
			{unsavedCount > 0 && (
				<p className='checkpoints-note'>{Strings.changes.unsavedNote(unsavedCount)}</p>
			)}
			{changes.files.length === 0
				? <p>{Strings.changes.none()}</p>
				: (
					<ul className='checkpoints-file-list'>
						{changes.files.map(file => (
							<li key={file.path} className='checkpoints-file-row'>
								<span className='checkpoints-file-path'>{file.path}</span>
								<span className='checkpoints-file-status'>{statusWord(file)}</span>
								{file.oldPath !== undefined && (
									<span className='checkpoints-file-note'>{Strings.changes.previousName(file.oldPath)}</span>
								)}
								{file.binary && (
									<span className='checkpoints-file-note'>{Strings.changes.binaryFile(ByteSize.formatSize(file.sizeBytes))}</span>
								)}
								<Button ariaLabel={`${Strings.actions.viewDetailedDifferences()}: ${file.path}`} className='checkpoints-link' onPressed={() => viewDifferences(file)}>
									{Strings.actions.viewDetailedDifferences()}
								</Button>
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
