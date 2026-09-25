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
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';
import { IContextMenuService } from '../../../../../platform/contextview/browser/contextView.js';
import { AnchorAlignment, AnchorAxisAlignment } from '../../../../../base/browser/ui/contextview/contextview.js';
import { Button, KeyboardModifiers, MouseTrigger } from '../../../../../base/browser/ui/positronComponents/button/button.js';

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
	/** Notified when the dropdown menu opens (true) and closes (false). */
	onMenuOpenChange?: (open: boolean) => void;
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
	onMenuOpenChange,
	children
}) => {
	const dropdownRef = useRef<HTMLButtonElement>(null);

	/**
	 * Shows the context menu for the dropdown.
	 */
	const showDropdownMenu = () => {
		if (!dropdownRef.current || disabled) {
			return;
		}

		const rect = dropdownRef.current.getBoundingClientRect();
		onMenuOpenChange?.(true);
		contextMenuService.showContextMenu({
			getActions: () => dropdownActions,
			getAnchor: () => ({ x: rect.left, y: rect.bottom }),
			anchorAlignment: AnchorAlignment.LEFT,
			anchorAxisAlignment: AnchorAxisAlignment.VERTICAL,
			onHide: () => onMenuOpenChange?.(false)
		});
	};

	return (
		<div className={positronClassNames('split-button', className, { 'disabled': disabled })}>
			<Button
				ariaLabel={ariaLabel}
				className='split-button-main'
				disabled={disabled}
				onPressed={onMainAction}
			>
				{children ?? label}
			</Button>
			<Button
				ref={dropdownRef}
				ariaLabel={dropdownTooltip}
				className='split-button-dropdown'
				disabled={disabled}
				mouseTrigger={MouseTrigger.MouseDown}
				tabIndex={disabled ? -1 : 0}
				tooltip={dropdownTooltip}
				onPressed={showDropdownMenu}
			>
				<span className={`codicon ${dropdownIconClass}`} />
			</Button>
		</div>
	);
};
