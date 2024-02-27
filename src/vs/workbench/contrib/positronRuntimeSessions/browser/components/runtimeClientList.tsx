/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./runtimeClientList';
import * as React from 'react';
import { RuntimeClient } from 'vs/workbench/contrib/positronRuntimeSessions/browser/components/runtimeClient';
import { ILanguageRuntimeSession } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';

interface runtimeClientListProps {
	readonly session: ILanguageRuntimeSession;
}

export const RuntimeClientList = (props: runtimeClientListProps) => {
	return <div className='runtime-client-list'>
		<table>
			<tbody>
				{props.session.clientInstances.map(client => {
					return <RuntimeClient key={client.getClientId()} client={client} />;
				})}</tbody>
		</table>
	</div>;
};
