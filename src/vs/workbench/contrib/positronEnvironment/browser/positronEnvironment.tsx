/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronEnvironment';
import * as React from 'react';
import { PropsWithChildren } from 'react'; // eslint-disable-line no-duplicate-imports
import { TestContent } from 'vs/workbench/contrib/positronEnvironment/browser/components/testContent';

/**
 * PositronEnvironmentProps interface.
 */
export interface PositronEnvironmentProps {
}

/**
 * PositronEnvironment component.
 * @param props A PositronEnvironmentProps that contains the component properties.
 */
export const PositronEnvironment = (props: PropsWithChildren<PositronEnvironmentProps>) => {
	return (
		<div>
			<TestContent message='Environment React' />
		</div>
	);
};
