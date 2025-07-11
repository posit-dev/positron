/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './copyAsCodeModalPopup.css';

// React.
import React, { useEffect, useState } from 'react';

import { PositronModalPopup } from '../../../../../../browser/positronComponents/positronModalPopup/positronModalPopup.js'
import { PositronModalReactRenderer } from '../../../../../positronModalReactRenderer/positronModalReactRenderer.js';
import { ICommandService } from '../../../../../../../platform/commands/common/commands.js';
import { DisposableStore } from '../../../../../../../base/common/lifecycle.js';
import { DataExplorerClientInstance } from '../../../../../../services/languageRuntime/common/languageRuntimeDataExplorerClient.js';
import { PositronDataExplorerCommandId } from '../../../../../../contrib/positronDataExplorerEditor/browser/positronDataExplorerActions.js';

interface CopyAsCodeModalPopupProps {
	anchorElement: HTMLElement;
	commandService: ICommandService;
	dataExplorerClientInstance: DataExplorerClientInstance
	renderer: PositronModalReactRenderer;
}

export const CopyAsCodeModalPopup = (props: CopyAsCodeModalPopupProps) => {
	const [codeString, setCodeString] = useState<string | undefined>('1234');


	useEffect(() => {
		const getCodeString = async () => {
			const codeString = await props.commandService.executeCommand<string>(PositronDataExplorerCommandId.CopyAsCodeAction);
			setCodeString(codeString);
		}
		getCodeString();
	}, [props.commandService]);

	// listen to onFilterChanged/sortChanged event (look at consoleInstanceInfoButton.tsx for example) and update the codeString state
	useEffect(() => {
		const disposableStore = new DisposableStore();

		const getCodeString = async () => {
			const codeString = await props.commandService.executeCommand<string>(PositronDataExplorerCommandId.CopyAsCodeAction);
			setCodeString(codeString);
		}

		// Add the onDidUpdateBackendState event handler.
		disposableStore.add(props.dataExplorerClientInstance.onDidUpdateBackendState(
			state => {
				getCodeString();
			})
		);

		return () => disposableStore.dispose();
	}, [props.commandService, props.dataExplorerClientInstance]);

	// Render.
	return (
		<PositronModalPopup
			anchorElement={props.anchorElement}
			height='auto' // maybe? depending on code content
			keyboardNavigationStyle='dialog'
			popupAlignment='auto'
			popupPosition='auto'
			renderer={props.renderer}
			width={400}
		>
			<pre>
				{codeString ?? 'hello'}
			</pre>
		</PositronModalPopup>
	)
};
