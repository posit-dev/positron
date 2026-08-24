/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './labeledTextInput.css';

// React.
import { ChangeEventHandler, forwardRef, useEffect, useId, useState } from 'react';

// Other dependencies.
import { useDebouncedValidator, ValidatorFn } from './useDebouncedValidator.js';
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';
import { ScreenReaderOnly } from '../../../../../base/browser/ui/positronComponents/ScreenReaderOnly.js';

/**
 * How long the field waits, after the error message changes, before a screen reader announces it.
 */
const ANNOUNCE_DELAY_MS = 500;

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

	// Ties the message below the input to the input itself, via aria-describedby.
	const errorMsgId = useId();

	// A validator message counts as invalid on its own, so the red border and the state a screen
	// reader is told match each other.
	const invalid = props.error || !!errorMsg;

	// The message a screen reader announces, held back until the user stops typing. The visible
	// message updates immediately; only the spoken one waits, so someone revalidating on every
	// keystroke does not hear a fresh error per character.
	const [announcedErrorMsg, setAnnouncedErrorMsg] = useState<string | undefined>(undefined);
	useEffect(() => {
		const timeout = setTimeout(() => setAnnouncedErrorMsg(errorMsg), ANNOUNCE_DELAY_MS);
		return () => clearTimeout(timeout);
	}, [errorMsg]);

	// Render.
	return (
		<div className={positronClassNames('labeled-text-input', { 'disabled': props.disabled })}>
			<label className='label'>
				<span className='label-text'>{props.label}</span>
				<input
					ref={ref}
					aria-describedby={errorMsg ? errorMsgId : undefined}
					aria-invalid={invalid}
					autoFocus={props.autoFocus}
					className={positronClassNames('text-input', { 'error': invalid })}
					disabled={props.disabled}
					max={props.max}
					maxLength={props.maxLength}
					min={props.min}
					type={props.type}
					value={props.value}
					onChange={props.onChange}
				/>
			</label>
			{/*
			 * The error message sits outside the label so it stays out of the input's accessible
			 * name, which a screen reader would otherwise only read when the input is focused. This
			 * element carries no aria-live: it is what aria-describedby points at, and a live region
			 * that is also a description gets read twice in Chrome with JAWS.
			 */}
			<div id={errorMsgId}>
				{errorMsg ? <span className='error error-msg'>{errorMsg}</span> : null}
			</div>
			{/*
			 * The announcement is a separate, off-screen copy. Polite rather than an alert, because
			 * the message can change on every keystroke and an alert would cut off the character the
			 * user just typed.
			 */}
			<ScreenReaderOnly>{announcedErrorMsg}</ScreenReaderOnly>
		</div>
	);
});

// Set the display name.
LabeledTextInput.displayName = 'LabeledTextInput';
// LabeledTextInput.defaultProps = {
// 	type: 'text'
// };

