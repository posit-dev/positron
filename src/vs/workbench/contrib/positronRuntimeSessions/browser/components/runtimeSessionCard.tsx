/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { ILanguageRuntimeSession } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';

interface runtimeSessionCardProps {
	readonly session: ILanguageRuntimeSession;
}

export const RuntimeSessionCard = (props: runtimeSessionCardProps) => {
	return (
		<tr>
			<td colSpan={4}>
				<div className='runtime-session-card'>
					{props.session.sessionName}
				</div>
			</td>
		</tr>
	);
};
