/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React from 'react';

// Other dependencies.
import { ConsoleInstanceState } from './consoleInstanceState.js';
import { usePositronConsoleContext } from '../positronConsoleContext.js';
import { IPositronConsoleInstance } from '../../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import * as path from 'path';
import { Codicon } from '../../../../../base/common/codicons.js';

interface NotebookTabProps {
	positronConsoleInstance: IPositronConsoleInstance;
}

export const NotebookTab = ({ positronConsoleInstance }: NotebookTabProps) => {
	// Variables
	const sessionId = positronConsoleInstance.sessionId;

	const sessionName = path.basename(
		positronConsoleInstance.sessionMetadata.notebookUri!.toString());

	// Context
	const positronConsoleContext = usePositronConsoleContext();

	return (
		<div
			key={`tab-${sessionId}`}
			aria-label={sessionName}
			aria-labelledby={`console-panel-${sessionId}`}
			aria-selected={positronConsoleContext.activePositronConsoleInstance?.sessionMetadata.sessionId === sessionId}
			className={`tab-button ${positronConsoleContext.activePositronConsoleInstance?.sessionMetadata.sessionId === sessionId && 'tab-button--active'}`}
			data-testid={`console-tab-${positronConsoleInstance.sessionMetadata.sessionId}`}
			role='tab'
		>
			<ConsoleInstanceState positronConsoleInstance={positronConsoleInstance} />
			<i className={'codicon codicon-' + Codicon.notebook.id} />
			<p className='session-name'>{sessionName}</p>
		</div>
	)
}
