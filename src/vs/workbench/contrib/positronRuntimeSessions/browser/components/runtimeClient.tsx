/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { IRuntimeClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeClientInstance';

interface runtimeClientProps {
	readonly client: IRuntimeClientInstance<any, any>;
}

export const RuntimeClient = (props: runtimeClientProps) => {
	return <div>
		<div>Client ID: {props.client.getClientId()}</div>
	</div>;
};
