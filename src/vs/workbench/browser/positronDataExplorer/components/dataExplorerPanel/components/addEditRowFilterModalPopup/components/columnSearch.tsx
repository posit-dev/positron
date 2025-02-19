/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './columnSearch.css';

// React.
import React, { useEffect, useRef, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../../../../../nls.js';
import { positronClassNames } from '../../../../../../../../base/common/positronUtilities.js';

/**
 * ColumnSearchProps interface.
 */
interface ColumnSearchProps {
	initialSearchText?: string;
	focus?: boolean;
	onSearchTextChanged: (searchText: string) => void;
	onNavigateOut?: (searchText: string) => void;
	onConfirmSearch?: (searchText: string) => void;
}

/**
 * ColumnSearch component.
 * @param props An ColumnSearchProps that contains the component properties.
 * @returns The rendered component.
 */
export const ColumnSearch = (props: ColumnSearchProps) => {
	// Reference hooks.
	const inputRef = useRef<HTMLInputElement>(undefined!);

	useEffect(() => {
		if (!props.focus) { return; }
		inputRef.current.focus();
	}, [inputRef, props.focus]);

	// State hooks.
	const [focused, setFocused] = useState(false);
	const [searchText, setSearchText] = useState(props.initialSearchText ?? '');

	const handleOnKeyDown = (evt: React.KeyboardEvent<HTMLInputElement>) => {
		switch (evt.code) {
			case 'ArrowDown':
			case 'Tab':
				if (!props.onNavigateOut) { break; }
				evt.stopPropagation();
				evt.preventDefault();
				props.onNavigateOut?.(evt.currentTarget.value);
				break;
			case 'Enter':
				if (!props.onConfirmSearch) { break; }
				evt.stopPropagation();
				evt.preventDefault();
				props.onConfirmSearch?.(evt.currentTarget.value);
				break;
		}
	};

	// Render.
	return (
		<div className='column-search-container'>
			<div className={positronClassNames('column-search-input', { 'focused': focused })}>
				<input
					ref={inputRef}
					className='text-input'
					placeholder={(() => localize('positron.searchPlacehold', "search"))()}
					type='text'
					value={searchText}
					onBlur={() => setFocused(false)}
					onChange={e => {
						setSearchText(e.target.value);
						props.onSearchTextChanged(e.target.value);
					}}
					onFocus={() => setFocused(true)}
					onKeyDown={handleOnKeyDown}
				/>
				{searchText !== '' && (
					<button className='clear-button'>
						<div
							className={'codicon codicon-positron-search-cancel'}
							onClick={() => {
								inputRef.current.value = '';
								setSearchText('');
								props.onSearchTextChanged('');
							}}
						/>
					</button>
				)}
			</div>
		</div>
	);
};
