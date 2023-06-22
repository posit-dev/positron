/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./labeledTextInput';
import * as React from 'react';
import { ChangeEventHandler, forwardRef } from 'react'; // eslint-disable-line no-duplicate-imports

/**
 * LabeledTextInputProps interface.
 */
export interface LabeledTextInputProps {
	label: string;
	value: string;
	autoFocus?: boolean;
	onChange: ChangeEventHandler<HTMLInputElement>;
}

/**
 * LabeledTextInput component.
 */
export const LabeledTextInput = forwardRef<HTMLInputElement, LabeledTextInputProps>((props, ref) => {
	// Render.
	return (
		<div className='labeled-text-input'>
			<label>
				{props.label}:
				<input className='text-input' ref={ref} type='text' value={props.value} autoFocus={props.autoFocus} onChange={props.onChange} />
			</label>
		</div>
	);
});
