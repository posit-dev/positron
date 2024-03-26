/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS>
import 'vs/css!./columnFilter';

// React.
import * as React from 'react';
import { ChangeEvent, useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { localize } from 'vs/nls';
import { positronClassNames } from 'vs/base/common/positronUtilities';

/**
 * ColumnFilterProps interface.
 */
interface ColumnFilterProps {
	// width: number;
	initialFilterText?: string;
	onFilterTextChanged: (filterText: string) => void;
}

/**
 * ColumnFilter component.
 * @param props An ColumnFilterProps that contains the component properties.
 * @returns The rendered component.
 */
export const ColumnFilter = (props: ColumnFilterProps) => {
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

	// style={{ width: props.width }}
	// Render.
	return (
		<div className='column-filter-container'>
			<div className={positronClassNames('column-filter-input', { 'focused': focused })}>
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
