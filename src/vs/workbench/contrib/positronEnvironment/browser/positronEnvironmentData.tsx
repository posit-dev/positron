/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronEnvironmentData';
import * as React from 'react';
import { PropsWithChildren } from 'react'; // eslint-disable-line no-duplicate-imports
import { TestContent } from 'vs/workbench/contrib/positronEnvironment/browser/components/testContent';

/**
 * PositronEnvironmentDataProps interface.
 */
export interface PositronEnvironmentDataProps {
}

/**
 * PositronEnvironmentData component.
 * @param props A PositronEnvironmentDataProps that contains the component properties.
 */
export const PositronEnvironment = (props: PropsWithChildren<PositronEnvironmentDataProps>) => {
	return (
		<div>
			<TestContent message='Environment Data React' />
		</div>
	);
};
