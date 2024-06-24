/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./rowFilterParameter';

// React.
import * as React from 'react';
import { forwardRef, useImperativeHandle, useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { positronClassNames } from 'vs/base/common/positronUtilities';

/**
 * RowFilterParameterProps interface.
 */
interface RowFilterParameterProps {
	placeholder?: string;
	value?: string;
	onTextChanged: (text: string) => void;
}

/**
 * RowFilterParameter component.
 * @param props An RowFilterParameterProps that contains the component properties.
 * @returns The rendered component.
 */
export const RowFilterParameter = forwardRef<HTMLInputElement, RowFilterParameterProps>((
	props,
	ref
) => {
	// Reference hooks.
	const inputRef = useRef<HTMLInputElement>(undefined!);

	// Customize the ref handle that is exposed.
	useImperativeHandle(ref, () => inputRef.current, []);

	// State hooks.
	const [focused, setFocused] = useState(false);
	const [text, setText] = useState(props.value ?? '');

	// Render.
	return (
		<div ref={ref} className='row-filter-parameter-container'>
			<div
				className={positronClassNames(
					'row-filter-parameter-input',
					{ 'focused': focused }
				)}
			>
				<input
					ref={inputRef}
					type='text'
					className='text-input'
					placeholder={props.placeholder}
					value={text}
					onFocus={() => setFocused(true)}
					onBlur={() => setFocused(false)}
					onChange={e => {
						setText(e.target.value);
						props.onTextChanged(e.target.value);
					}}
				/>
			</div>
		</div>
	);
});

// Set the display name.
RowFilterParameter.displayName = 'RowFilterParameter';
