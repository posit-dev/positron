/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './actionBarFilter.css';

// React.
import React, { ChangeEvent, forwardRef, useImperativeHandle, useRef, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../nls.js';
import { positronClassNames } from '../../../../base/common/positronUtilities.js';
import { Icon as IconType } from '../../../action/common/action.js';
import { Icon } from './icon.js';
import { Codicon } from '../../../../base/common/codicons.js';

/**
 * ActionBarFilterSize type.
 */
type ActionBarFilterSize = 'sm' | 'md';

/**
 * ActionBarFilterProps interface.
 */
interface ActionBarFilterProps {
	width?: number | string;
	disabled?: boolean;
	initialFilterText?: string;
	placeholder?: string;
	clearButtonIcon?: IconType;
	showClearAlways?: boolean;
	size?: ActionBarFilterSize;
	onFilterTextChanged: (filterText: string) => void;
	/**
	 * Optional handler invoked when the filter button is pressed. When provided,
	 * a filter icon button is rendered to the right of the clear button. The
	 * anchor element is passed so callers can position a context menu relative
	 * to the button.
	 */
	onFilterButtonPressed?: (anchorElement: HTMLElement) => void;
	/**
	 * Tooltip for the filter button. Only used when onFilterButtonPressed is provided.
	 */
	filterButtonTooltip?: string;
}

export interface ActionBarFilterHandle {
	setFilterText: (text: string) => void;
	focus: () => void;
}

/**
 * ActionBarFilter component.
 * @param props An ActionBarFilterProps that contains the component properties.
 * @returns The rendered component.
 */
export const ActionBarFilter = forwardRef<ActionBarFilterHandle, ActionBarFilterProps>((props, ref) => {
	// Reference hooks.
	const inputRef = useRef<HTMLInputElement>(undefined!);
	const filterButtonRef = useRef<HTMLButtonElement>(null);

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

	// Filter button click handler.
	const filterButtonClickHandler = () => {
		if (filterButtonRef.current) {
			props.onFilterButtonPressed?.(filterButtonRef.current);
		}
	};

	// Filter button key down handler.
	const filterButtonKeyDownHandler = (e: React.KeyboardEvent<HTMLButtonElement>) => {
		if (e.code === 'Enter' || e.code === 'Space') {
			e.preventDefault();
			filterButtonClickHandler();
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
		},
		focus: () => {
			inputRef.current.focus();
		}
	}));

	const sizeClassName = props.size === 'md' ? 'action-bar-filter-input-md' : 'action-bar-filter-input-sm';

	// Render.
	return (
		<div className='action-bar-filter-container' style={{ width: props.width }}>
			<div className={positronClassNames('action-bar-filter-input', sizeClassName, { 'focused': focused })}>
				<input
					ref={inputRef}
					className='text-input'
					disabled={props.disabled}
					placeholder={props.placeholder ?? localize('positronFilterPlaceholder', "Filter")}
					type='text'
					value={filterText}
					onBlur={() => setFocused(false)}
					onChange={changeHandler}
					onFocus={() => setFocused(true)}
					onKeyDown={inputKeyDownHandler}
				/>
				{(filterText !== '' || props.showClearAlways) && (
					<button
						aria-label={localize('positronClearFilter', "Clear filter")}
						className='clear-button'
						disabled={props.disabled || filterText === ''}
						onClick={buttonClearClickHandler}
						onKeyDown={buttonClearKeyDownHandler}
					>
						<Icon icon={props.clearButtonIcon ?? Codicon.positronSearchCancel} />
					</button>
				)}
				{props.onFilterButtonPressed && (
					<button
						ref={filterButtonRef}
						aria-haspopup='menu'
						aria-label={localize('positronFilterOptions', "Filter options")}
						className='filter-button'
						disabled={props.disabled}
						title={props.filterButtonTooltip}
						onClick={filterButtonClickHandler}
						onKeyDown={filterButtonKeyDownHandler}
					>
						<Icon icon={Codicon.filter} />
					</button>
				)}
			</div>
		</div>
	);
});
