/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./actionBarFind';
import * as React from 'react';
import { useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { localize } from 'vs/nls';
import { positronClassNames } from 'vs/base/common/positronUtilities';
import { ActionBarButton } from 'vs/platform/positronActionBar/browser/components/actionBarButton';

/**
 * ActionBarFindProps interface.
 */
interface ActionBarFindProps {
	width: number;
	placeholder: string;
	initialFindText?: string;
	onFindTextChanged: (findText: string) => void;
}

/**
 * ActionBarFind component.
 * @param props An ActionBarFindProps that contains the component properties.
 * @returns The component.
 */
export const ActionBarFind = (props: ActionBarFindProps) => {
	// Hooks.
	const [focused, setFocused] = useState(false);
	const [findText, setFindText] = useState(props.initialFindText ?? '');
	const inputRef = useRef<HTMLInputElement>(undefined!);

	// Input change handler.
	const inputChangeHandler = (e: React.ChangeEvent<HTMLInputElement>) => {
		setFindText(e.target.value);
		props.onFindTextChanged(e.target.value);
	};

	// Button find previous click handler.
	const buttonFindPreviousClickHandler = () => {
		console.log('Find previous was clicked');
	};

	// Button find next click handler.
	const buttonFindNextClickHandler = () => {
		console.log('Find next was clicked');
	};

	// Button clear click handler.
	const buttonClearClickHandler = () => {
		console.log(`Clear was clicked ${findText}`);
	};

	// Render.
	return (
		<div className='action-bar-find-container' style={{ width: props.width }}>
			<div className={positronClassNames('action-bar-find-input', { 'focused': focused })}>
				<input
					ref={inputRef}
					type='text'
					className='text-input'
					placeholder={props.placeholder}
					value={findText}
					onFocus={() => setFocused(true)}
					onBlur={() => setFocused(false)}
					onChange={inputChangeHandler} />
				<div className='action-bar-find-counter'>1/3</div>
			</div>
			<ActionBarButton layout='tight' iconId='positron-chevron-up' tooltip={localize('positronFindPrevious', "Find previous")} onClick={buttonFindPreviousClickHandler} />
			<ActionBarButton layout='tight' iconId='positron-chevron-down' tooltip={localize('positronFindNext', "Find next")} onClick={buttonFindNextClickHandler} />
			<ActionBarButton layout='tight' iconId='positron-clear' tooltip={localize('positronClearFind', "Clear find")} onClick={buttonClearClickHandler} />
		</div>
	);
};
