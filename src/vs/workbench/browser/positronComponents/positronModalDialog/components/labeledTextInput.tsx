/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./labeledTextInput';

// React.
import * as React from 'react';
import { ChangeEventHandler, forwardRef } from 'react'; // eslint-disable-line no-duplicate-imports
import { positronClassNames } from 'vs/base/common/positronUtilities';
import { Delayer } from 'vs/base/common/async';

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


const DEBOUNCE_DELAY = 100;
/**
 * A hook to debounce the validation of input values.
 *
 * Is a bit more complicated than a typical debouncer because it needs to handle the async nature of
 * the validator. Currently the validator is synchronous, but it could be async in the future.
 */
function useDebouncedValidator({ validator, value }: Pick<LabeledTextInputProps, 'validator' | 'value'>) {
	const [errorMsg, setErrorMsg] = React.useState<string | undefined>(undefined);

	// Create a state to store the delayer instance across rerenders.
	const delayerRef = React.useRef<Delayer<string | undefined>>();
	React.useEffect(() => {
		if (!validator) {
			// Don't unnecessarily create a delayer if we don't have a validator.
			return;
		}
		const delayer = new Delayer<string | undefined>(DEBOUNCE_DELAY);
		delayerRef.current = delayer;
		return () => delayer.dispose();
	}, [validator]);

	React.useEffect(() => {
		if (!validator || !delayerRef.current) { return; }

		delayerRef.current
			.trigger(() => validator(value))
			.then(setErrorMsg);
	}, [validator, value]);

	return errorMsg;
}

