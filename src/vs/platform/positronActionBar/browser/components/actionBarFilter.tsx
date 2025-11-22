/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './actionBarFilter.css';

// React.
import React, { ChangeEvent, forwardRef, useImperativeHandle, useRef, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../nls.js';
import { positronClassNames } from '../../../../base/common/positronUtilities.js';

/**
 * ActionBarFilterProps interface.
 */
interface ActionBarFilterProps {
	width: number;
	disabled?: boolean;
	initialFilterText?: string;
	placeholder?: string;
	onFilterTextChanged: (filterText: string) => void;
}

export interface ActionBarFilterHandle {
	setFilterText: (text: string) => void;
}

/**
 * ActionBarFilter component.
 * @param props An ActionBarFilterProps that contains the component properties.
 * @returns The rendered component.
 */
export const ActionBarFilter = forwardRef<ActionBarFilterHandle, ActionBarFilterProps>((props, ref) => {
	// Reference hooks.
	const inputRef = useRef<HTMLInputElement>(undefined!);

	// State hooks.
	const [focused, setFocused] = useState(false);
	const [filterText, setFilterText] = useState(props.initialFilterText ?? '');

	// Change handler.
	const changeHandler = (e: ChangeEvent<HTMLInputElement>) => {
		setFilterText(e.target.value);
		props.onFilterTextChanged(e.target.value);
	};

	// Button clear click handler.
	const buttonClearClickHandler = () => {
		inputRef.current.value = '';
		setFilterText('');
		props.onFilterTextChanged('');
		// Move focus back to the input after clearing the text.
		inputRef.current.focus();
	};

	// Button clear key down handler.
	const buttonClearKeyDownHandler = (e: React.KeyboardEvent<HTMLButtonElement>) => {
		if (e.code === 'Enter' || e.code === 'Space') {
			e.preventDefault();
			buttonClearClickHandler();
		}
	};

	// Input key down handler.
	const inputKeyDownHandler = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === 'Escape' && filterText !== '') {
			e.preventDefault();
			e.stopPropagation();
			buttonClearClickHandler();
		}
	};

	useImperativeHandle(ref, () => ({
		setFilterText: (text: string) => {
			setFilterText(text);
			inputRef.current.value = text;
			props.onFilterTextChanged(text);
		}
	}));

	// Render.
	return (
		<div className='action-bar-filter-container' style={{ width: props.width }}>
			<div className={positronClassNames('action-bar-filter-input', { 'focused': focused })}>
				<input
					ref={inputRef}
					className='text-input'
					disabled={props.disabled}
					placeholder={props.placeholder ?? (() => localize('positronFilterPlaceholder', "Filter"))()}
					type='text'
					value={filterText}
					onBlur={() => setFocused(false)}
					onChange={changeHandler}
					onFocus={() => setFocused(true)}
					onKeyDown={inputKeyDownHandler}
				/>
				{filterText !== '' && (
					<button
						aria-label={(() => localize('positronClearFilter', "Clear filter"))()}
						className='clear-button'
						disabled={props.disabled}
						onClick={buttonClearClickHandler}
						onKeyDown={buttonClearKeyDownHandler}
					>
						<div className={'codicon codicon-positron-search-cancel'} />
					</button>
				)}
			</div>
		</div>
	);
});
