/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './actionBarFilter.css';

// React.
import React, { ChangeEvent, useRef, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../nls.js';
import { positronClassNames } from '../../../../base/common/positronUtilities.js';

/**
 * ActionBarFilterProps interface.
 */
interface ActionBarFilterProps {
	width: number;
	initialFilterText?: string;
	onFilterTextChanged: (filterText: string) => void;
}

/**
 * ActionBarFilter component.
 * @param props An ActionBarFilterProps that contains the component properties.
 * @returns The rendered component.
 */
export const ActionBarFilter = (props: ActionBarFilterProps) => {
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
	};

	// Render.
	return (
		<div className='action-bar-filter-container' style={{ width: props.width }}>
			<div className={positronClassNames('action-bar-filter-input', { 'focused': focused })}>
				<input
					ref={inputRef}
					className='text-input'
					placeholder={(() => localize('positronFilterPlacehold', "filter"))()}
					type='text'
					value={filterText}
					onBlur={() => setFocused(false)}
					onChange={changeHandler}
					onFocus={() => setFocused(true)} />
				{filterText !== '' && (
					<button className='clear-button'>
						<div className={'codicon codicon-positron-search-cancel'} onClick={buttonClearClickHandler} />
					</button>
				)}
			</div>
		</div>
	);
};
