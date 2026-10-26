/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './positronPreview.css';

// React.
import { PropsWithChildren, useEffect, useState } from 'react';

// Other dependencies.
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { PreviewContainer } from './components/previewContainer.js';
import { IPositronPreviewService, POSITRON_PREVIEW_NOTEBOOK_RENDERER_VIEW_TYPE, PreviewOpenTarget } from './positronPreviewSevice.js';
import { PreviewWebview } from './previewWebview.js';
import { PositronPreviewViewPane } from './positronPreviewView.js';
import { UrlActionBars } from './components/urlActionBars.js';
import { PreviewUrl } from './previewUrl.js';
import { PreviewHtml } from './previewHtml.js';
import { HtmlActionBars } from './components/htmlActionBars.js';
import { BasicActionBars } from './components/basicActionBars.js';
import { WebviewActionBars } from './components/webviewActionBars.js';
import { usePositronReactServicesContext } from '../../../../base/browser/positronReactRendererContext.js';

/**
 * PositronPreviewProps interface.
 */
export interface PositronPreviewProps {
	readonly reactComponentContainer: PositronPreviewViewPane;
}

/**
 * PositronPreview component.
 * @param props A PositronPreviewProps that contains the component properties.
 * @returns The rendered component.
 */
export const PositronPreview = (props: PropsWithChildren<PositronPreviewProps>) => {
	// Context hooks.
	const services = usePositronReactServicesContext();

	// Hooks.
	const [width, setWidth] = useState(props.reactComponentContainer.width);
	const [height, setHeight] = useState(props.reactComponentContainer.height);
	const [x, setX] = useState(0);
	const [y, setY] = useState(0);
	const [visible, setVisible] = useState(props.reactComponentContainer.containerVisible);

	// Initial selected preview item.
	const initialActivePreview = services.positronPreviewService.activePreviewWebview;
	const [activePreview, setActivePreview] = useState<PreviewWebview | undefined>(initialActivePreview);
	const [, setStoppableVersion] = useState(0);

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

		disposableStore.add(services.positronPreviewService.onDidChangeActivePreviewWebview(id => {
			const activePreview = services.positronPreviewService.activePreviewWebview;
			setActivePreview(activePreview);
		}));

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, [services.positronPreviewService, props.reactComponentContainer]);

	// Re-render when the active preview's stoppable state changes. The toolbar
	// reads `activePreview.stoppable` during render, so switching previews never
	// shows a stale toolbar. The state can change between the render and this
	// subscription, so re-render once on subscribe too.
	useEffect(() => {
		if (!activePreview) {
			return;
		}
		const rerender = () => setStoppableVersion(version => version + 1);
		const disposable = activePreview.onDidChangeStoppable(rerender);
		rerender();
		return () => disposable.dispose();
	}, [activePreview]);

	const urlToolbar = activePreview && activePreview instanceof PreviewUrl;
	const htmlToolbar = activePreview && activePreview instanceof PreviewHtml;
	const basicToolbar =
		activePreview && activePreview.viewType === POSITRON_PREVIEW_NOTEBOOK_RENDERER_VIEW_TYPE;
	const webviewToolbar = activePreview && activePreview.stoppable && !urlToolbar && !htmlToolbar && !basicToolbar;
	const showToolbar = urlToolbar || htmlToolbar || basicToolbar || webviewToolbar;

	// Render.
	return (
		<>
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
			{basicToolbar &&
				<BasicActionBars key={activePreview.previewId} preview={activePreview} {...props} />
			}
			{webviewToolbar &&
				<WebviewActionBars key={activePreview.previewId} preview={activePreview} {...props} />
			}
			<PreviewContainer
				height={height - (showToolbar ? 32 : 0)}
				preview={activePreview}
				visible={visible}
				width={width}
				x={x}
				y={y} />
		</>
	);
};
export { IPositronPreviewService, PreviewOpenTarget };

