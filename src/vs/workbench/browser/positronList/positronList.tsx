/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import { JSX } from 'react';

// Other dependencies.
import { PositronListInstance } from './classes/positronListInstance.js';
import { PositronDataGrid } from '../positronDataGrid/positronDataGrid.js';

/**
 * PositronListProps interface.
 */
interface PositronListProps<T> {
	id?: string;
	instance: PositronListInstance<T>;
}

/**
 * PositronList component.
 */
export const PositronList = <T,>({ id, instance }: PositronListProps<T>): JSX.Element => {
	return <PositronDataGrid id={id} instance={instance} />;
};
