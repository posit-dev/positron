/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./environmentList';
import * as React from 'react';
import { PropsWithChildren } from 'react'; // eslint-disable-line no-duplicate-imports
import { PositronList } from 'vs/base/browser/ui/positronList/positronList';
import { usePositronEnvironmentContext } from 'vs/workbench/contrib/positronEnvironment/browser/positronEnvironmentContext';

/**
 * EnvironmentListProps interface.
 */
export interface EnvironmentListProps {
	width: number;
	height: number;
}

/**
 * EnvironmentList component.
 * @param props A PositronEnvironmentProps that contains the component properties.
 * @returns The rendered component.
 */
export const EnvironmentList = (props: PropsWithChildren<EnvironmentListProps>) => {
	// Hooks.
	const positronEnvironmentContext = usePositronEnvironmentContext();

	// If there isn't a current language environment, render the list accordingly.
	if (!positronEnvironmentContext.currentLanguageEnvironment) {
		return (
			<div className='no-language-environment-message'>No Language Environment</div>
		);
	}

	// Render.
	return (
		<PositronList height={props.height} listItemsProvider={positronEnvironmentContext.currentLanguageEnvironment} />
	);
};
