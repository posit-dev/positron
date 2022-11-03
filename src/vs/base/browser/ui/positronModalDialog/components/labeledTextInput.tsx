/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./labeledTextInput';
import * as React from 'react';
import { forwardRef } from 'react'; // eslint-disable-line no-duplicate-imports

/**
 * LabeledTextInputProps interface.
 */
export interface LabeledTextInputProps {
	label: string;
	value: string;
	onChange: React.ChangeEventHandler<HTMLInputElement>;
	autoFocus?: boolean;
}

/**
 * LabeledTextInput component.
 */
export const LabeledTextInput = forwardRef<HTMLInputElement, LabeledTextInputProps>((props: LabeledTextInputProps, ref) => {
	// Render.
	return (
		<div className='labeled-text-input'>
			<label>
				{props.label}: <br />
				<input className='text-input' ref={ref} type='text' value={props.value} autoFocus={props.autoFocus} onChange={props.onChange} />
			</label>
		</div>
	);
});
