/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./actionBarFilter';
import * as React from 'react';
import { ChangeEvent, useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { localize } from 'vs/nls';
import { positronClassNames } from 'vs/base/common/positronUtilities';

/**
 * ActionBarFilterProps interface.
 */
interface ActionBarFilterProps {
	width: number;
	initialFilterText?: string;
	onFilterTextChanged: (findText: string) => void;
}

/**
 * ActionBarFilter component.
 * @param props An ActionBarFilterProps that contains the component properties.
 * @returns The rendered component.
 */
export const ActionBarFilter = (props: ActionBarFilterProps) => {
	// Hooks.
	const [focused, setFocused] = useState(false);
	const [filterText, setFilterText] = useState(props.initialFilterText ?? '');
	const inputRef = useRef<HTMLInputElement>(undefined!);

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
					type='text'
					className='text-input'
					placeholder={localize('positronFilterPlacehold', "filter")}
					value={filterText}
					onFocus={() => setFocused(true)}
					onBlur={() => setFocused(false)}
					onChange={changeHandler} />
				{filterText !== '' && (
					<button className='clear-button'>
						<div className={'codicon codicon-positron-search-cancel'} onClick={buttonClearClickHandler} />
					</button>
				)}
			</div>
		</div>
	);
};
