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
import { IPositronPreviewService, PreviewOpenTarget } from './positronPreviewSevice.js';
import { PreviewWebview } from './previewWebview.js';
import { PositronPreviewViewPane } from './positronPreviewView.js';
import { PreviewActionBars } from './components/previewActionBars.js';
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

	// Render.
	return (
		<>
			{/* Key the action bars to the preview; otherwise the URL bar, an
			uncontrolled component, can get out of sync with the preview. */}
			<PreviewActionBars key={activePreview?.previewId} preview={activePreview} {...props} />
			<PreviewContainer
				height={height - 32}
				preview={activePreview}
				visible={visible}
				width={width}
				x={x}
				y={y} />
		</>
	);
};
export { IPositronPreviewService, PreviewOpenTarget };

