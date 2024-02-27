/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./runtimeSessionCard';
import * as React from 'react';
import { ILanguageRuntimeSession } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';
import { RuntimeExitReason } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

interface runtimeSessionCardProps {
	readonly session: ILanguageRuntimeSession;
}

export const RuntimeSessionCard = (props: runtimeSessionCardProps) => {
	const shutdownSession = () => {
		props.session.shutdown(RuntimeExitReason.Shutdown);
	};

	const forceQuitSession = () => {
		props.session.forceQuit();
	};

	return (
		<tr>
			<td colSpan={4}>
				<div className='runtime-session-card'>
					<div className='runtime-icon'>
						<img src={'data:image/svg+xml;base64,' + props.session.metadata.base64EncodedIconSvg} />
					</div>
					<div className='runtime-name'>
						{props.session.metadata.runtimeName}
						&nbsp;
						<span className='runtime-extension'>
							[{props.session.metadata.extensionId.value}]
						</span>
					</div>
					<div className='runtime-id'>
						{props.session.metadata.runtimeId}
					</div>
					<div className='runtime-path'>
						{props.session.metadata.runtimePath}
					</div>
				</div>
				<div className='runtime-action-buttons'>
					<button onClick={forceQuitSession}>force quit</button>
					<button onClick={shutdownSession}>shut down</button>
				</div>
			</td>
		</tr>
	);
};
