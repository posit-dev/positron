/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './labeledTextInput.css';

// React.
import React, { ChangeEventHandler, forwardRef } from 'react';

// Other dependencies.
import { useDebouncedValidator, ValidatorFn } from './useDebouncedValidator.js';
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';

/**
 * LabeledTextInputProps interface.
 */
export interface LabeledTextInputProps {
	label: string;
	value: string | number;
	autoFocus?: boolean;
	max?: number;
	min?: number;
	type?: 'text' | 'number' | 'password';
	error?: boolean;
	/**
	 * Custom error message. Will override the validator error message if present.
	 */
	errorMsg?: string;
	validator?: ValidatorFn<string | number>;
	onChange?: ChangeEventHandler<HTMLInputElement>;
	/**
	 * Maximum allowed number of characters in the input field.
	 */
	maxLength?: number;
	disabled?: boolean;
}

/**
 * LabeledTextInput component.
 */
export const LabeledTextInput = forwardRef<HTMLInputElement, LabeledTextInputProps>((props, ref) => {

	const validatorErrorMsg = useDebouncedValidator(props);

	const errorMsg = props.errorMsg || validatorErrorMsg;

	// Render.
	return (
		<div className={positronClassNames('labeled-text-input', { 'disabled': props.disabled })}>
			<label className='label'>
				<span className='label-text'>{props.label}</span>
				<input
					ref={ref}
					autoFocus={props.autoFocus}
					className={positronClassNames('text-input', { 'error': props.error })}
					disabled={props.disabled}
					max={props.max}
					maxLength={props.maxLength}
					min={props.min}
					type={props.type}
					value={props.value}
					onChange={props.onChange}
				/>
				{errorMsg ? <span className='error error-msg'>{errorMsg}</span> : null}
			</label>
		</div>
	);
});

// Set the display name.
LabeledTextInput.displayName = 'LabeledTextInput';
// LabeledTextInput.defaultProps = {
// 	type: 'text'
// };

