/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronPreview';
import * as React from 'react';
import { PropsWithChildren, useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { PreviewContainer } from 'vs/workbench/contrib/positronPreview/browser/components/previewContainer';
import { PositronPreviewServices } from 'vs/workbench/contrib/positronPreview/browser/positronPreviewState';
import { PositronPreviewContextProvider } from 'vs/workbench/contrib/positronPreview/browser/positronPreviewContext';
import { IPositronPreviewService } from 'vs/workbench/contrib/positronPreview/browser/positronPreviewSevice';
import { PreviewWebview } from 'vs/workbench/contrib/positronPreview/browser/previewWebview';
import { PositronPreviewViewPane } from 'vs/workbench/contrib/positronPreview/browser/positronPreviewView';

/**
 * PositronPreviewProps interface.
 */
export interface PositronPreviewProps extends PositronPreviewServices {
	// Services.
	readonly commandService: ICommandService;
	readonly configurationService: IConfigurationService;
	readonly contextKeyService: IContextKeyService;
	readonly contextMenuService: IContextMenuService;
	readonly keybindingService: IKeybindingService;
	readonly layoutService: IWorkbenchLayoutService;
	readonly reactComponentContainer: PositronPreviewViewPane;
	readonly positronPreviewService: IPositronPreviewService;
}

/**
 * PositronPreview component.
 * @param props A PositronPreviewProps that contains the component properties.
 * @returns The rendered component.
 */
export const PositronPreview = (props: PropsWithChildren<PositronPreviewProps>) => {

	// Hooks.
	const [width, setWidth] = useState(props.reactComponentContainer.width);
	const [height, setHeight] = useState(props.reactComponentContainer.height);
	const [x, setX] = useState(0);
	const [y, setY] = useState(0);
	const [visible, setVisible] = useState(props.reactComponentContainer.containerVisible);

	// Initial selected preview item.
	const initialActivePreview = props.positronPreviewService.activePreviewWebview;
	const [activePreview, setActivePreview] = useState<PreviewWebview | undefined>(initialActivePreview);

	// Add IReactComponentContainer event handlers.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add the onSizeChanged event handler.
		disposableStore.add(props.reactComponentContainer.onSizeChanged(size => {
			setWidth(size.width);
			setHeight(size.height);
		}));

		// Add the onPositionChanged event handler.
		disposableStore.add(props.reactComponentContainer.onPositionChanged(pos => {
			setX(pos.x);
			setY(pos.y);
		}));

		// Add the onVisibilityChanged event handler.
		disposableStore.add(props.reactComponentContainer.onVisibilityChanged(visible => {
			setVisible(visible);
		}));

		disposableStore.add(props.positronPreviewService.onDidChangeActivePreviewWebview(id => {
			const activePreview = props.positronPreviewService.activePreviewWebview;
			setActivePreview(activePreview);
		}));

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, []);

	// Render.
	return (
		<PositronPreviewContextProvider {...props}>
			<PreviewContainer
				preview={activePreview}
				visible={visible}
				width={width}
				height={height}
				x={x}
				y={y} />
		</PositronPreviewContextProvider>
	);
};
export { IPositronPreviewService };

