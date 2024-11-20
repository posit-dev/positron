/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./actionBarFind';
import * as React from 'react';
import { ChangeEvent, useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { localize } from 'vs/nls';
import { positronClassNames } from 'vs/base/common/positronUtilities';
import { ActionBarButton } from 'vs/platform/positronActionBar/browser/components/actionBarButton';

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
					type='text'
					className='text-input'
					placeholder={(() => localize('positronFindPlacehold', "find"))()}
					value={findText}
					onFocus={() => setFocused(true)}
					onBlur={() => setFocused(false)}
					onChange={changeHandler} />
				{findText !== '' && (
					<button className='clear-button'>
						<div className={'codicon codicon-positron-search-cancel'} onClick={buttonClearClickHandler} />
					</button>
				)}
			</div>
			<ActionBarButton iconId='chevron-up' align='right' tooltip={(() => localize('positronFindPrevious', "Find previous"))()} disabled={!props.findResults} onPressed={() => props.onFindPrevious!()} />
			<ActionBarButton iconId='chevron-down' align='right' tooltip={(() => localize('positronFindNext', "Find next"))()} disabled={!props.findResults} onPressed={() => props.onFindNext!()} />
		</div>
	);
};
