/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import React from 'react';
import 'vs/css!./positronConnections';
import { SchemaNavigation } from 'vs/workbench/contrib/positronConnections/browser/components/schemaNavigation';
import { PositronConnectionsContextProvider, PositronConnectionsServices } from 'vs/workbench/contrib/positronConnections/browser/positronConnectionsContext';

export interface PositronConnectionsProps extends PositronConnectionsServices { }

export const PositronConnections = (props: React.PropsWithChildren<PositronConnectionsProps>) => {
	return (
		<div className='positron-connections'>
			<PositronConnectionsContextProvider {...props}>
				<SchemaNavigation></SchemaNavigation>
			</PositronConnectionsContextProvider>
		</div>
	);
};
