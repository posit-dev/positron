/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './actionBars.css';

// React.
import { PropsWithChildren, useEffect, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { PositronActionBar } from '../../../../../platform/positronActionBar/browser/positronActionBar.js';
import { PositronActionBarContextProvider } from '../../../../../platform/positronActionBar/browser/positronActionBarContext.js';
import { kPaddingLeft, kPaddingRight } from './actionBars.js';
import { ActionBarRegion } from '../../../../../platform/positronActionBar/browser/components/actionBarRegion.js';
import { ActionBarButton } from '../../../../../platform/positronActionBar/browser/components/actionBarButton.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { PreviewWebview } from '../previewWebview.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';

const clear = localize('positron.preview.html.clear', "Clear the content");

/**
 * HtmlActionBarsProps interface.
 */
export interface BasicActionBarsProps {

	// The active preview.
	readonly preview: PreviewWebview;
}

export const BasicActionBars = (props: PropsWithChildren<BasicActionBarsProps>) => {

	const services = usePositronReactServicesContext();
	const [title, setTitle] = useState(`${props.preview.name} output`);

	// Handler for the clear button.
	const clearHandler = () => {
		services.positronPreviewService.clearAllPreviews();
	};

	// Main use effect.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();
		disposableStore.add(props.preview.webview.onDidLoad((title) => {
			if (title) {
				setTitle(title);
			}
		}));
		return () => disposableStore.dispose();
	}, [props.preview.webview]);

	// Render.
	return (
		<PositronActionBarContextProvider {...props}>
			<div className='action-bars preview-action-bar'>
				<PositronActionBar borderBottom={true} borderTop={true} paddingLeft={kPaddingLeft} paddingRight={kPaddingRight}>
					<ActionBarRegion location='left'>
						<span className='codicon codicon-file'></span>
					</ActionBarRegion>
					<ActionBarRegion location='center'>
						<span className='preview-title'>{title}</span>
					</ActionBarRegion>
					<ActionBarRegion location='right'>
						<ActionBarButton
							align='right'
							ariaLabel={clear}
							icon={ThemeIcon.fromId('clear-all')}
							tooltip={clear}
							onPressed={clearHandler} />
					</ActionBarRegion>
				</PositronActionBar>
			</div>
		</PositronActionBarContextProvider>
	);
};
