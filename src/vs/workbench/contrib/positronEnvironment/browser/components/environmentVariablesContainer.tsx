/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./environmentVariablesContainer';
import * as React from 'react';
import { PropsWithChildren } from 'react'; // eslint-disable-line no-duplicate-imports

/**
 * EnvironmentVariablesContainer component.
 * @returns The rendered component.
 */
export const EnvironmentVariablesContainer = (props: PropsWithChildren) => {
	// Render.
	return (
		<div className='environment-variables-container'>
			{props.children}
		</div>
	);
};
