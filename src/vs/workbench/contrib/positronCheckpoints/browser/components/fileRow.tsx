/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { PropsWithChildren } from 'react';
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';
import { IChangedFile } from '../../../../services/positronCheckpoints/common/checkpointsTypes.js';
import { Strings } from '../../common/checkpointsStrings.js';
import { statusWord } from './fileStatus.js';

interface IFileRowProps {
	file: IChangedFile;
	/** Opens the detailed differences of the file. */
	onViewDifferences(): void;
}

/**
 * One changed file in a list: its path at the left, its status word as a tag and the icon
 * button for its detailed differences at the right, and the notes given as children on the
 * lines below.
 */
export const FileRow = ({ file, onViewDifferences, children }: PropsWithChildren<IFileRowProps>) => (
	<li className='checkpoints-file-row'>
		<div className='checkpoints-file-main'>
			<span className='checkpoints-file-path'>{file.path}</span>
			<span className={`checkpoints-tag checkpoints-file-status checkpoints-file-status-${file.status}`}>{statusWord(file)}</span>
			<Button
				ariaLabel={Strings.actions.viewDetailedDifferencesOf(file.path)}
				className='checkpoints-icon-button'
				tooltip={Strings.actions.viewDetailedDifferences()}
				onPressed={onViewDifferences}
			>
				<span aria-hidden='true' className='codicon codicon-diff' />
			</Button>
		</div>
		{file.oldPath !== undefined && (
			<span className='checkpoints-file-note'>{Strings.changes.previousName(file.oldPath)}</span>
		)}
		{children}
	</li>
);
