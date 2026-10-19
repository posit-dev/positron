/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './actionBars.css';

// React.
import { PropsWithChildren } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { PositronActionBar } from '../../../../../platform/positronActionBar/browser/positronActionBar.js';
import { PositronActionBarContextProvider } from '../../../../../platform/positronActionBar/browser/positronActionBarContext.js';
import { kPaddingLeft, kPaddingRight } from './actionBars.js';
import { ActionBarRegion } from '../../../../../platform/positronActionBar/browser/components/actionBarRegion.js';
import { ActionBarButton } from '../../../../../platform/positronActionBar/browser/components/actionBarButton.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { PreviewWebview } from '../previewWebview.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';

const clear = localize('positron.preview.webview.clear', "Clear the content");
const stop = localize('positron.preview.webview.stop', "Stop the preview");

/**
 * WebviewActionBarsProps interface.
 */
export interface WebviewActionBarsProps {

	// The active preview.
	readonly preview: PreviewWebview;
}

/**
 * WebviewActionBars component. Extension webviews draw their own navigation
 * controls, so this bar only has stop and clear.
 * @param props A WebviewActionBarsProps that contains the component properties.
 * @returns The rendered component.
 */
export const WebviewActionBars = (props: PropsWithChildren<WebviewActionBarsProps>) => {
	// Context hooks.
	const services = usePositronReactServicesContext();

	// Handler for the clear button.
	const clearHandler = () => {
		services.positronPreviewService.clearAllPreviews();
	};

	// Render.
	return (
		<PositronActionBarContextProvider {...props}>
			<div className='action-bars preview-action-bar'>
				{/* eslint-disable-next-line no-restricted-syntax -- matches the other preview action bars; two icon buttons have nothing to overflow. */}
				<PositronActionBar borderBottom={true} borderTop={true} paddingLeft={kPaddingLeft} paddingRight={kPaddingRight}>
					{/* The center region grows to push the buttons to the right, as in the other preview action bars. */}
					<ActionBarRegion location='center' />
					<ActionBarRegion location='right'>
						<ActionBarButton
							align='right'
							ariaLabel={stop}
							tooltip={stop}
							onPressed={() => props.preview.requestStop()}>
							<div className='action-bar-button-icon interrupt codicon codicon-positron-interrupt-runtime' />
						</ActionBarButton>
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
