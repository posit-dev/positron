/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './actionBarFind.css';

// React.
import React, { ChangeEvent, useRef, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../nls.js';
import { positronClassNames } from '../../../../base/common/positronUtilities.js';
import { ActionBarButton } from './actionBarButton.js';

/**
 * ActionBarFindProps interface.
 */
interface ActionBarFindProps {
	width: number;
	initialFindText?: string;
	findResults: boolean;
	onFindTextChanged: (findText: string) => void;
	onFindPrevious: () => void;
	onFindNext: () => void;
}

/**
 * ActionBarFind component.
 * @param props An ActionBarFindProps that contains the component properties.
 * @returns The rendered component.
 */
export const ActionBarFind = (props: ActionBarFindProps) => {
	// Hooks.
	const [focused, setFocused] = useState(false);
	const [findText, setFindText] = useState(props.initialFindText ?? '');
	const inputRef = useRef<HTMLInputElement>(undefined!);

	// Change handler.
	const changeHandler = (e: ChangeEvent<HTMLInputElement>) => {
		setFindText(e.target.value);
		props.onFindTextChanged(e.target.value);
	};

	// Button clear click handler.
	const buttonClearClickHandler = () => {
		inputRef.current.value = '';
		setFindText('');
		props.onFindTextChanged('');
	};

	// Render.
	return (
		<div className='action-bar-find-container' style={{ width: props.width }}>
			<div className={positronClassNames('action-bar-find-input', { 'focused': focused })}>
				<input
					ref={inputRef}
					className='text-input'
					placeholder={(() => localize('positronFindPlacehold', "find"))()}
					type='text'
					value={findText}
					onBlur={() => setFocused(false)}
					onChange={changeHandler}
					onFocus={() => setFocused(true)} />
				{findText !== '' && (
					<button className='clear-button'>
						<div className={'codicon codicon-positron-search-cancel'} onClick={buttonClearClickHandler} />
					</button>
				)}
			</div>
			<ActionBarButton align='right' disabled={!props.findResults} iconId='chevron-up' tooltip={(() => localize('positronFindPrevious', "Find previous"))()} onPressed={() => props.onFindPrevious!()} />
			<ActionBarButton align='right' disabled={!props.findResults} iconId='chevron-down' tooltip={(() => localize('positronFindNext', "Find next"))()} onPressed={() => props.onFindNext!()} />
		</div>
	);
};
