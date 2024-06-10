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
	/**
	 * Custom error message. Will override the validator error message if present.
	 */
	errorMsg?: string;
	validator?: ValidatorFn;
	onChange: ChangeEventHandler<HTMLInputElement>;
	/**
	 * Maximum allowed number of characters in the input field.
	 */
	maxLength?: number;
}

/**
 * LabeledTextInput component.
 */
export const LabeledTextInput = forwardRef<HTMLInputElement, LabeledTextInputProps>((props, ref) => {

	const validatorErrorMsg = useDebouncedValidator(props);

	const errorMsg = props.errorMsg || validatorErrorMsg;

	// Render.
	return (
		<div className='labeled-text-input'>
			<label className='label'>
				{props.label}
				<input
					className={positronClassNames('text-input', { 'error': props.error })}
					ref={ref}
					type={props.type}
					value={props.value}
					autoFocus={props.autoFocus}
					onChange={props.onChange}
					max={props.max}
					min={props.min}
					maxLength={props.maxLength}
				/>
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

