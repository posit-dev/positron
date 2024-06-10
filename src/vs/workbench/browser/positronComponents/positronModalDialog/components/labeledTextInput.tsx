/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./labeledTextInput';

// React.
import * as React from 'react';
import { ChangeEventHandler, forwardRef } from 'react'; // eslint-disable-line no-duplicate-imports
import { positronClassNames } from 'vs/base/common/positronUtilities';

// Other dependencies.
import { useDebouncedValidator, ValidatorFn } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/useDebouncedValidator';

/**
 * LabeledTextInputProps interface.
 */
export interface LabeledTextInputProps {
	label: string;
	value: string | number;
	autoFocus?: boolean;
	max?: number;
	min?: number;
	type?: 'text' | 'number';
	error?: boolean;
	validator?: ValidatorFn;
	onChange: ChangeEventHandler<HTMLInputElement>;
}

/**
 * LabeledTextInput component.
 */
export const LabeledTextInput = forwardRef<HTMLInputElement, LabeledTextInputProps>((props, ref) => {

	const errorMsg = useDebouncedValidator(props);

	// Render.
	return (
		<div className='labeled-text-input'>
			<label className='label'>
				{props.label}
				<input className={positronClassNames('text-input', { 'error': props.error })} ref={ref} type={props.type} value={props.value}
					autoFocus={props.autoFocus} onChange={props.onChange} max={props.max} min={props.min} />
				{errorMsg ? <span className='error error-msg'>{errorMsg}</span> : null}
			</label>
		</div>
	);
});

// Set the display name.
LabeledTextInput.displayName = 'LabeledTextInput';
LabeledTextInput.defaultProps = {
	type: 'text'
};

