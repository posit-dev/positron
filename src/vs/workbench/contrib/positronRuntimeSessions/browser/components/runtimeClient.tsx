/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./runtimeClient';
import * as React from 'react';
import { IRuntimeClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeClientInstance';

interface runtimeClientProps {
	readonly client: IRuntimeClientInstance<any, any>;
}

export const RuntimeClient = (props: runtimeClientProps) => {
	return <tr className='runtime-client'>
		<td>
			<div className='client-type'>{props.client.getClientType()}</div>
			<div className='client-id'>{props.client.getClientId()}</div>
		</td>
		<td>
			{props.client.getClientState()}
		</td>
	</tr>;
};
