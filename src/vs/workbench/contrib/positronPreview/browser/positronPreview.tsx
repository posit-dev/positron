/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './positronPreview.css';

// React.
import React, { PropsWithChildren, useEffect, useState } from 'react';

// Other dependencies.
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IWorkbenchLayoutService } from '../../../services/layout/browser/layoutService.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { PreviewContainer } from './components/previewContainer.js';
import { PositronPreviewServices } from './positronPreviewState.js';
import { PositronPreviewContextProvider } from './positronPreviewContext.js';
import { IPositronPreviewService } from './positronPreviewSevice.js';
import { PreviewWebview } from './previewWebview.js';
import { PositronPreviewViewPane } from './positronPreviewView.js';
import { UrlActionBars } from './components/urlActionBars.js';
import { IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { PreviewUrl } from './previewUrl.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { PreviewHtml } from './previewHtml.js';
import { HtmlActionBars } from './components/htmlActionBars.js';
import { IAccessibilityService } from '../../../../platform/accessibility/common/accessibility.js';

/**
 * PositronPreviewProps interface.
 */
export interface PositronPreviewProps extends PositronPreviewServices {
	// Services.
	readonly accessibilityService: IAccessibilityService;
	readonly commandService: ICommandService;
	readonly configurationService: IConfigurationService;
	readonly contextKeyService: IContextKeyService;
	readonly contextMenuService: IContextMenuService;
	readonly hoverService: IHoverService;
	readonly keybindingService: IKeybindingService;
	readonly layoutService: IWorkbenchLayoutService;
	readonly openerService: IOpenerService;
	readonly notificationService: INotificationService;
	readonly positronPreviewService: IPositronPreviewService;
	readonly reactComponentContainer: PositronPreviewViewPane;
	readonly runtimeSessionService: IRuntimeSessionService;
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
	}, [props.positronPreviewService, props.reactComponentContainer]);

	const urlToolbar = activePreview && activePreview instanceof PreviewUrl;
	const htmlToolbar = activePreview && activePreview instanceof PreviewHtml;
	const showToolbar = urlToolbar || htmlToolbar;
	// Render.
	return (
		<PositronPreviewContextProvider {...props}>
			{urlToolbar &&
				// Render the action bars. We supply the preview ID as a key
				// here to ensure the action bars are keyed to the preview;
				// otherwise the URL bar can get out of sync with the preview
				// since it's an uncontrolled component.
				<UrlActionBars key={activePreview.previewId} preview={activePreview} {...props} />
			}
			{htmlToolbar &&
				<HtmlActionBars key={activePreview.previewId} preview={activePreview} {...props} />
			}
			<PreviewContainer
				height={height - (showToolbar ? 32 : 0)}
				preview={activePreview}
				visible={visible}
				width={width}
				x={x}
				y={y} />
		</PositronPreviewContextProvider>
	);
};
export { IPositronPreviewService };

