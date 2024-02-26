/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { IReactComponentContainer } from 'vs/base/browser/positronReactRenderer';
import { ILanguageRuntimeSession } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';

/**
 * RuntimeSessionProps interface.
 */
interface RuntimeSessionProps {
	readonly width: number;
	readonly height: number;
	readonly session: ILanguageRuntimeSession;
	readonly reactComponentContainer: IReactComponentContainer;
}

/**
* RuntimeSession component.
* @param props A RuntimeSessionProps that contains the component properties.
* @returns The rendered component.
*/
export const RuntimeSession = (props: RuntimeSessionProps) => {

	// Render.
	return (
		<tr className='runtime-session'>
			<td>
				{props.session.sessionName}
			</td>
			<td>
				{props.session.sessionId}
			</td>
			<td>
				{props.session.sessionMode}
			</td>
		</tr>
	);
};
