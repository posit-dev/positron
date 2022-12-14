/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./listItem';
import * as React from 'react';
import { PropsWithChildren } from 'react'; // eslint-disable-line no-duplicate-imports

/**
 * FooBarProps interface.
 */
export interface FooBarProps {
}

/**
 * FooBar component.
 * @param props A FooBarProps that contains the component properties.
 * @returns The rendered component.
 */
export const FooBar = (props: PropsWithChildren<FooBarProps>) => {
	// Render.
	return (
		<div>
			{props.children}
		</div>
	);
};
