/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronConsole';
import * as React from 'react';
import { PropsWithChildren, useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { DisposableStore } from 'vs/base/common/lifecycle';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IReactComponentContainer } from 'vs/base/browser/positronReactRenderer';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { ConsoleCore } from 'vs/workbench/contrib/positronConsole/browser/components/consoleCore';
import { PositronConsoleServices } from 'vs/workbench/contrib/positronConsole/browser/positronConsoleState';
import { PositronConsoleContextProvider } from 'vs/workbench/contrib/positronConsole/browser/positronConsoleContext';

/**
 * PositronConsoleProps interface.
 */
export interface PositronConsoleProps extends PositronConsoleServices {
	// Services.
	readonly commandService: ICommandService;
	readonly configurationService: IConfigurationService;
	readonly contextKeyService: IContextKeyService;
	readonly contextMenuService: IContextMenuService;
	readonly keybindingService: IKeybindingService;
	readonly layoutService: IWorkbenchLayoutService;
	readonly reactComponentContainer: IReactComponentContainer;
}

/**
 * PositronConsole component.
 * @param props A PositronConsoleProps that contains the component properties.
 * @returns The rendered component.
 */
export const PositronConsole = (props: PropsWithChildren<PositronConsoleProps>) => {
	// Hooks.
	const [height, setHeight] = useState(props.reactComponentContainer.height);

	// Add IReactComponentContainer event handlers.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add the onSizeChanged event handler.
		disposableStore.add(props.reactComponentContainer.onSizeChanged(size => {
			setHeight(size.height);
		}));

		// Add the onVisibilityChanged event handler.
		disposableStore.add(props.reactComponentContainer.onVisibilityChanged(visibility => {
			// TODO@softwarenerd - For the moment, doing nothing.
		}));

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, []);

	console.log(`Rendering positron console with height of ${height}`);

	// Render.
	return (
		<PositronConsoleContextProvider {...props}>
			<div className='positron-console'>
				<ConsoleCore height={height} {...props} />
			</div>
		</PositronConsoleContextProvider>
	);
};
