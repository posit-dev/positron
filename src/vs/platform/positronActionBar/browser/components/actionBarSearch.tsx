/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./actionBarSearch';
import * as React from 'react';
import { useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { positronClassNames } from 'vs/base/common/positronClassNames';

/**
 * ActionBarSearch component.
 * @returns The component.
 */
export const ActionBarSearch = () => {
	// Hooks.
	const [focused, setFocused] = useState(false);

	// Focus handler.
	const focusHandler = () => {
		setFocused(true);
	};

	// Blur handler.
	const blurHandler = () => {
		setFocused(false);
	};

	// Create the class names.
	const classNames = positronClassNames(
		'action-bar-search',
		{ 'focused': focused }
	);

	// Render.
	return (
		<div className={classNames}>
			<button className='clear-button'>
				<div className='clear-button-icon codicon codicon-positron-search-icon' />
			</button>
			<input type='text' className='text-input' placeholder='search' onFocus={focusHandler} onBlur={blurHandler} />
			<button className='clear-button'>
				<div className='clear-button-icon codicon codicon-positron-search-cancel' />
			</button>
		</div>
	);
};
