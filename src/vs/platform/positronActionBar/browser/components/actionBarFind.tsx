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
	onFindPrevious: () => void;
	onFindNext: () => void;
}

/**
 * ActionBarFind component.
 * @param props An ActionBarFindProps that contains the component properties.
 * @returns The component.
 */
export const ActionBarFind = (props: ActionBarFindProps) => {
	// Hooks.
	const [focused, setFocused] = useState(false);
	const inputRef = useRef<HTMLInputElement>(undefined!);

	// Button clear click handler.
	const buttonClearClickHandler = () => {
		inputRef.current.value = '';
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
					placeholder={props.placeholder}
					value={props.initialFindText ?? ''}
					onFocus={() => setFocused(true)}
					onBlur={() => setFocused(false)}
					onChange={e => props.onFindTextChanged(e.target.value)} />
			</div>
			<ActionBarButton layout='tight' iconId='positron-chevron-up' align='right' tooltip={localize('positronFindPrevious', "Find previous")} onClick={() => props.onFindPrevious()} />
			<ActionBarButton layout='tight' iconId='positron-chevron-down' align='right' tooltip={localize('positronFindNext', "Find next")} onClick={() => props.onFindNext()} />
			<ActionBarButton layout='tight' iconId='positron-clear' align='right' tooltip={localize('positronClearFind', "Clear find")} onClick={buttonClearClickHandler} />
		</div>
	);
};
