/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./topActionBarSelectBox';
import * as React from 'react';
import { MouseEvent, PropsWithChildren } from 'react'; // eslint-disable-line no-duplicate-imports
import { positronClassNames } from 'vs/base/common/positronUtilities';
import { AnythingQuickAccessProviderRunOptions } from 'vs/platform/quickinput/common/quickAccess';
import { usePositronTopActionBarContext } from 'vs/workbench/browser/parts/positronTopActionBar/positronTopActionBarContext';

export interface TopActionBarSelectBoxProps {
	onClick?: (event: React.MouseEvent) => void;
	onDropDownClick?: (event: React.MouseEvent) => void;
	className?: string;
}

export const TopActionBarSelectBox = (props: PropsWithChildren<TopActionBarSelectBoxProps>) => {
	// Hooks.
	const positronTopActionBarContext = usePositronTopActionBarContext();

	// Ckick handler.
	const clickHandler = (e: MouseEvent<HTMLDivElement>) => {
		e.preventDefault();
		e.stopPropagation();

		positronTopActionBarContext.quickInputService.quickAccess.show(undefined, {
			providerOptions: {
				includeHelp: true,
			} as AnythingQuickAccessProviderRunOptions
		});
	};

	// DropDownCkick handler.
	const dropDownClickHandler = (e: MouseEvent<HTMLButtonElement>) => {
		e.preventDefault();
		e.stopPropagation();

		positronTopActionBarContext.quickInputService.quickAccess.show('?');
	};

	// Create the class names.
	const classNames = positronClassNames(
		'top-action-bar-select-box',
		{ 'top-action-bar-select-box-drop-down-click': props.onDropDownClick },
		props.className
	);

	// Render.
	return (
		<div className={classNames} onClick={(e) => clickHandler(e)}>
			<div className='left'>
				<div className='codicon codicon-positron-search' />
			</div>
			<div className='center'>
				Search
			</div>
			<div className='right'>
				<button className='drop-down' onClick={(e) => dropDownClickHandler(e)}>
					<div className='chevron codicon codicon-chevron-down' />
				</button>
			</div>
		</div>
	);
};
