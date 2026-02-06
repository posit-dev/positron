/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './SplitButton.css';

// React.
import React, { PropsWithChildren, useRef } from 'react';

// Other dependencies.
import { IAction } from '../../../../../base/common/actions.js';
import { IContextMenuService } from '../../../../../platform/contextview/browser/contextView.js';
import { AnchorAlignment, AnchorAxisAlignment } from '../../../../../base/browser/ui/contextview/contextview.js';
import { PositronButton } from '../../../../../base/browser/ui/positronComponents/button/positronButton.js';
import { KeyboardModifiers } from '../../../../../base/browser/ui/positronComponents/button/button.js';

/**
 * Props for the SplitButton component.
 */
export interface SplitButtonProps {
	/** Label text for the main button (used if no children provided) */
	label?: string;
	/** Aria label for the main button */
	ariaLabel: string;
	/** Tooltip for the dropdown button */
	dropdownTooltip: string;
	/** CSS class name for the button container */
	className?: string;
	/** Whether the button is disabled */
	disabled?: boolean;
	/** Handler for main button click, receives keyboard modifiers */
	onMainAction: (modifiers: KeyboardModifiers) => void;
	/** Actions to show in the dropdown menu */
	dropdownActions: IAction[];
	/** Context menu service for showing the dropdown */
	contextMenuService: IContextMenuService;
	/** Custom dropdown icon class (defaults to codicon-chevron-down) */
	dropdownIconClass?: string;
}

/**
 * SplitButton component - a button with a main action and a dropdown menu for additional actions.
 * The main button triggers the primary action, while the dropdown arrow shows a context menu
 * with additional options.
 *
 * Can be used with a simple label prop or with children for custom button content.
 */
export const SplitButton: React.FC<PropsWithChildren<SplitButtonProps>> = ({
	label,
	ariaLabel,
	dropdownTooltip,
	className,
	disabled,
	onMainAction,
	dropdownActions,
	contextMenuService,
	dropdownIconClass = 'codicon-chevron-down',
	children
}) => {
	const dropdownRef = useRef<HTMLDivElement>(null);

	/**
	 * Shows the context menu for the dropdown.
	 */
	const showDropdownMenu = (event: React.SyntheticEvent<HTMLDivElement>) => {
		event.preventDefault();
		event.stopPropagation();

		if (!dropdownRef.current || disabled) {
			return;
		}

		const rect = dropdownRef.current.getBoundingClientRect();
		contextMenuService.showContextMenu({
			getActions: () => dropdownActions,
			getAnchor: () => ({ x: rect.left, y: rect.bottom }),
			anchorAlignment: AnchorAlignment.LEFT,
			anchorAxisAlignment: AnchorAxisAlignment.VERTICAL
		});
	};

	return (
		<div className={`split-button ${className ?? ''} ${disabled ? 'disabled' : ''}`}>
			<PositronButton
				ariaLabel={ariaLabel}
				className='split-button-main'
				disabled={disabled}
				onPressed={onMainAction}
			>
				{children ?? label}
			</PositronButton>
			<div
				ref={dropdownRef}
				aria-label={dropdownTooltip}
				className='split-button-dropdown'
				role='button'
				tabIndex={disabled ? -1 : 0}
				title={dropdownTooltip}
				onKeyDown={(e) => {
					if ((e.key === 'Enter' || e.key === ' ') && !disabled) {
						showDropdownMenu(e);
					}
				}}
				onMouseDown={(e) => {
					if (!disabled) {
						showDropdownMenu(e);
					}
				}}
			>
				<span className={`codicon ${dropdownIconClass}`} />
			</div>
		</div>
	);
};
