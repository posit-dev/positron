/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./actionBarFind';
import * as React from 'react';
import { useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { positronClassNames } from 'vs/base/common/positronClassNames';
import { ActionBarButton } from 'vs/platform/positronActionBar/browser/components/actionBarButton';
import { localize } from 'vs/nls';

/* THIS IS NOT CURRENTLY BEING USED. IT WAS KEPT AROUND BECAUSE I ANTICIPATE THAT IT WILL */
/* BE USED IN THE FUTURE AND I DON'T WANT TO HAVE TO REWRITE IT. */

/**
 * ActionBarFindProps interface.
 */
interface ActionBarFindProps {
	placeholder: string;
}

/**
 * ActionBarFind component.
 * @param props An ActionBarFindProps that contains the component properties.
 * @returns The component.
 */
export const ActionBarFind = (props: ActionBarFindProps) => {
	// Hooks.
	const [focused, setFocused] = useState(false);
	const [findText, setFindText] = useState('');
	const inputRef = useRef<HTMLInputElement>(undefined!);

	// // Cancel button click handler.
	// const cancelButtonClickHandler = () => {
	// 	inputRef.current.value = '';
	// 	setFindText('');
	// };

	// Render.
	return (
		<div className='action-bar-find-a'>
			<div className={positronClassNames('action-bar-find', { 'focused': focused })}>
				<input
					ref={inputRef}
					type='text'
					className='text-input'
					placeholder={props.placeholder}
					onFocus={() => setFocused(true)}
					onBlur={() => setFocused(false)}
					onChange={(e) => setFindText(e.target.value)} />
				<div className='action-bar-find-counter'>1/3</div>
			</div>
			<ActionBarButton layout='tight' iconId='positron-chevron-up' tooltip={localize('positronFindPrevious', "Find previous")} />
			<ActionBarButton layout='tight' iconId='positron-chevron-down' tooltip={localize('positronFindNext', "Find next")} />
			<ActionBarButton layout='tight' iconId='positron-clear' tooltip={localize('positronClearFind', "Clear find")} />
		</div>
	);
};
