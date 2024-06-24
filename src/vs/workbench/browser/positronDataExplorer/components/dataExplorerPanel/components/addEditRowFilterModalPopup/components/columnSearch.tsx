/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./columnSearch';

// React.
import * as React from 'react';
import { useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports

// Other dependencies.
import { localize } from 'vs/nls';
import { positronClassNames } from 'vs/base/common/positronUtilities';

/**
 * ColumnSearchProps interface.
 */
interface ColumnSearchProps {
	initialSearchText?: string;
	onSearchTextChanged: (searchText: string) => void;
}

/**
 * ColumnSearch component.
 * @param props An ColumnSearchProps that contains the component properties.
 * @returns The rendered component.
 */
export const ColumnSearch = (props: ColumnSearchProps) => {
	// Reference hooks.
	const inputRef = useRef<HTMLInputElement>(undefined!);

	// State hooks.
	const [focused, setFocused] = useState(false);
	const [searchText, setSearchText] = useState(props.initialSearchText ?? '');

	// Render.
	return (
		<div className='column-search-container'>
			<div className={positronClassNames('column-search-input', { 'focused': focused })}>
				<input
					ref={inputRef}
					type='text'
					className='text-input'
					placeholder={(() => localize('positron.searchPlacehold', "search"))()}
					value={searchText}
					onFocus={() => setFocused(true)}
					onBlur={() => setFocused(false)}
					onChange={e => {
						setSearchText(e.target.value);
						props.onSearchTextChanged(e.target.value);
					}}
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
