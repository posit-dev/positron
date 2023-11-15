/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronVariables';
import * as React from 'react';
import { PropsWithChildren, useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { DisposableStore } from 'vs/base/common/lifecycle';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IReactComponentContainer } from 'vs/base/browser/positronReactRenderer';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { VariablesCore } from 'vs/workbench/contrib/positronVariables/browser/components/variablesCore';
import { PositronVariablesServices } from 'vs/workbench/contrib/positronVariables/browser/positronVariablesState';
import { PositronVariablesContextProvider } from 'vs/workbench/contrib/positronVariables/browser/positronVariablesContext';
import { IPositronVariablesService } from 'vs/workbench/services/positronVariables/common/interfaces/positronVariablesService';

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
	}, []);

	// Render.
	return (
		<PositronVariablesContextProvider {...props}>
			<div className='positron-variables'>
				<VariablesCore width={width} height={height} {...props} />
			</div>
		</PositronVariablesContextProvider>
	);
};
