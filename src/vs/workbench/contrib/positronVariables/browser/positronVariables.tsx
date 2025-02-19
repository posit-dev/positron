/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './positronVariables.css';

// React.
import React, { PropsWithChildren, useEffect, useState } from 'react';

// Other dependencies.
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IReactComponentContainer } from '../../../../base/browser/positronReactRenderer.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IWorkbenchLayoutService } from '../../../services/layout/browser/layoutService.js';
import { VariablesCore } from './components/variablesCore.js';
import { PositronVariablesServices } from './positronVariablesState.js';
import { PositronVariablesContextProvider } from './positronVariablesContext.js';
import { IPositronVariablesService } from '../../../services/positronVariables/common/interfaces/positronVariablesService.js';

/**
 * PositronVariablesProps interface.
 */
export interface PositronVariablesProps extends PositronVariablesServices {
	// Services.
	readonly clipboardService: IClipboardService;
	readonly commandService: ICommandService;
	readonly configurationService: IConfigurationService;
	readonly contextKeyService: IContextKeyService;
	readonly contextMenuService: IContextMenuService;
	readonly keybindingService: IKeybindingService;
	readonly layoutService: IWorkbenchLayoutService;
	readonly positronVariablesService: IPositronVariablesService;
	readonly reactComponentContainer: IReactComponentContainer;
}

/**
 * PositronVariables component.
 * @param props A PositronVariablesProps that contains the component properties.
 * @returns The rendered component.
 */
export const PositronVariables = (props: PropsWithChildren<PositronVariablesProps>) => {
	// State hooks.
	const [width, setWidth] = useState(props.reactComponentContainer.width);
	const [height, setHeight] = useState(props.reactComponentContainer.height);

	// Add IReactComponentContainer event handlers.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add the onSizeChanged event handler.
		disposableStore.add(props.reactComponentContainer.onSizeChanged(size => {
			setWidth(size.width);
			setHeight(size.height);
		}));

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, [props.reactComponentContainer]);

	// Render.
	return (
		<PositronVariablesContextProvider {...props}>
			<div className='positron-variables'>
				<VariablesCore height={height} width={width} {...props} />
			</div>
		</PositronVariablesContextProvider>
	);
};
