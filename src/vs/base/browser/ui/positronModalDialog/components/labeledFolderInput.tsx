/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./labeledFolderInput';
import * as React from 'react';
import { ChangeEventHandler } from 'react'; // eslint-disable-line no-duplicate-imports
import { Button } from 'vs/base/browser/ui/positronComponents/button/button';

/**
 * FolderInputProps interface.
 */
export interface LabeledFolderInputProps {
	label: string;
	value: string;
	onBrowse: VoidFunction;
	onChange: ChangeEventHandler<HTMLInputElement>;
}

/**
 * LabeledFolderInput component.
 * @param props A LabeledFolderInputProps that contains the component properties.
 * @returns The rendered component.
 */
export const LabeledFolderInput = (props: LabeledFolderInputProps) => {
	return (
		<div className='labeled-folder-input'>
			<label>
				{props.label}:
				<div className='folder-input'>
					<input className='text-input' readOnly type='text' value={props.value} onChange={props.onChange} />
					<Button className='browse-button' onPressed={props.onBrowse}>
						Browse...
					</Button>
				</div>
			</label>
		</div>
	);
};

