/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./labeledTextInput';

// React.
import * as React from 'react';
import { ChangeEventHandler, forwardRef } from 'react'; // eslint-disable-line no-duplicate-imports
import { positronClassNames } from 'vs/base/common/positronUtilities';

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
	validator?: (value: string | number) => string | undefined;
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


/**
 * A hook to debounce the validation of input values.
*
*/
const DEBOUNCE_DELAY = 100;
function useDebouncedValidator({ validator, value }: Pick<LabeledTextInputProps, 'validator' | 'value'>) {
	const [errorMsg, setErrorMsg] = React.useState<string | undefined>(undefined);

	const callbackTimeoutRef = React.useRef<NodeJS.Timeout | undefined>();

	const clearCallbackTimeout = React.useCallback(() => {
		if (!callbackTimeoutRef.current) { return; }
		clearTimeout(callbackTimeoutRef.current);
	}, []);

	React.useEffect(() => {
		if (!validator) { return; }

		clearCallbackTimeout();

		callbackTimeoutRef.current = setTimeout(() => {
			setErrorMsg(validator(value));
		}, DEBOUNCE_DELAY);

		return clearCallbackTimeout;
	}, [clearCallbackTimeout, validator, value]);

	return errorMsg;
}

