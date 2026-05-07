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
interface PositronListProps<TItem, TSection> {
	id?: string;
	instance: PositronListInstance<TItem, TSection>;
}

/**
 * PositronList component.
 */
export const PositronList = <TItem, TSection = never>({ id, instance }: PositronListProps<TItem, TSection>): JSX.Element => {
	return <PositronDataGrid id={id} instance={instance} />;
};
