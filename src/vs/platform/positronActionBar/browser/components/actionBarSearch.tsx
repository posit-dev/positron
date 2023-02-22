/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./actionBarSearch';
import * as React from 'react';
import { useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { positronClassNames } from 'vs/base/common/positronUtilities';

/* THIS IS NOT CURRENTLY BEING USED. IT WAS KEPT AROUND BECAUSE I ANTICIPATE THAT IT WILL */
/* BE USED IN THE FUTURE AND I DON'T WANT TO HAVE TO REWRITE IT. */

/**
 * ActionBarSearchProps interface.
 */
interface ActionBarSearchProps {
	placeholder: string;
}

/**
 * ActionBarSearch component.
 * @param props An ActionBarSearchProps that contains the component properties.
 * @returns The rendered component.
 */
export const ActionBarSearch = (props: ActionBarSearchProps) => {
	// Hooks.
	const [focused, setFocused] = useState(false);
	const [searchText, setSearchText] = useState('');
	const inputRef = useRef<HTMLInputElement>(undefined!);

	// Search button click handler.
	const searchButtonClickHandler = () => {
		console.log('SEARCH BUTTON CLICKED');
	};

	// Cancel button click handler.
	const cancelButtonClickHandler = () => {
		inputRef.current.value = '';
		setSearchText('');
	};

	// Render.
	return (
		<div className={positronClassNames('action-bar-search', { 'focused': focused })}>
			<button className='action-bar-search-button' onClick={searchButtonClickHandler}>
				<div className='action-bar-search-button-icon codicon codicon-positron-search-icon' />
			</button>
			<input
				ref={inputRef}
				type='text'
				className='text-input'
				placeholder={props.placeholder}
				onFocus={() => setFocused(true)}
				onBlur={() => setFocused(false)}
				onChange={(e) => setSearchText(e.target.value)} />
			<button className='action-bar-search-button' onClick={cancelButtonClickHandler}>
				<div className={positronClassNames('action-bar-search-button-icon', 'codicon', 'codicon-positron-search-cancel', { 'disabled': searchText === '' })} />
			</button>
		</div>
	);
};
