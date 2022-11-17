/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./actionBarSearch';
import * as React from 'react';
import { localize } from 'vs/nls';
import { useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { positronClassNames } from 'vs/base/common/positronClassNames';

/**
 * ActionBarSearch component.
 * @returns The component.
 */
export const ActionBarSearch = () => {
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
				placeholder={localize('positronSearchPlaceholder', "Search")}
				onFocus={() => setFocused(true)}
				onBlur={() => setFocused(false)}
				onChange={(e) => setSearchText(e.target.value)} />
			<button className='action-bar-search-button' onClick={cancelButtonClickHandler}>
				<div className={positronClassNames('action-bar-search-button-icon', 'codicon', 'codicon-positron-search-cancel', { 'disabled': searchText === '' })} />
			</button>
		</div>
	);
};
