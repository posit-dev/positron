/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
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
import { PreviewHtml } from '../previewHtml.js';
import { ActionBarRegion } from '../../../../../platform/positronActionBar/browser/components/actionBarRegion.js';
import { ActionBarButton } from '../../../../../platform/positronActionBar/browser/components/actionBarButton.js';
import { ActionBarMenuButton } from '../../../../../platform/positronActionBar/browser/components/actionBarMenuButton.js';
import { ActionBarSeparator } from '../../../../../platform/positronActionBar/browser/components/actionBarSeparator.js';
import { IAction } from '../../../../../base/common/actions.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { PreviewOpenTarget } from '../positronPreviewSevice.js';

const reload = localize('positron.preview.html.reload', "Reload the content");
const clear = localize('positron.preview.html.clear', "Clear the content");
const openInBrowserLabel = localize('positron.preview.html.openInBrowser.menu', "Open in Browser");
const openInEditorLabel = localize('positron.preview.html.openInEditor.menu', "Open in Editor Tab");
const openInDropdownLabel = localize('positron.preview.html.openInDropdown', "Select where to open");

/**
 * HtmlActionBarsProps interface.
 */
export interface HtmlActionBarsProps {

	// The active preview.
	readonly preview: PreviewHtml;
}

export const HtmlActionBars = (props: PropsWithChildren<HtmlActionBarsProps>) => {

	const services = usePositronReactServicesContext();
	const [title, setTitle] = useState(props.preview.html?.title);

	// State for the remembered "Open in..." target. Persisted via the preview
	// service so it survives remounts and reloads.
	const [rememberedOpenTarget, setRememberedOpenTarget] = useState<PreviewOpenTarget>(() =>
		services.positronPreviewService.getDefaultOpenTarget()
	);

	// Handler for the reload button.
	const reloadHandler = () => {
		props.preview.webview.postMessage({
			channel: 'execCommand',
			data: 'reload-window'
		});
	};

	// Handler for the clear button.
	const clearHandler = () => {
		services.positronPreviewService.clearAllPreviews();
	};

	// Handler for the open in browser button.
	const openInBrowserHandler = () => {
		setRememberedOpenTarget(PreviewOpenTarget.Browser);
		services.positronPreviewService.setDefaultOpenTarget(PreviewOpenTarget.Browser);
		services.openerService.open(props.preview.uri,
			{ openExternal: true, fromUserGesture: true });
	};

	// Handler for open in editor button
	const openInEditorHandler = () => {
		setRememberedOpenTarget(PreviewOpenTarget.EditorTab);
		services.positronPreviewService.setDefaultOpenTarget(PreviewOpenTarget.EditorTab);
		services.positronPreviewService.openEditor(props.preview.uri, title);
	};

	// Builds the dropdown actions. The "checked" action is the remembered
	// target, which is what the split-button's primary click repeats.
	const openInActions = (): IAction[] => [
		{
			id: 'positron.preview.html.openInBrowser',
			label: openInBrowserLabel,
			tooltip: '',
			class: undefined,
			checked: rememberedOpenTarget === PreviewOpenTarget.Browser,
			enabled: true,
			run: openInBrowserHandler,
		},
		{
			id: 'positron.preview.html.openInEditor',
			label: openInEditorLabel,
			tooltip: '',
			class: undefined,
			checked: rememberedOpenTarget === PreviewOpenTarget.EditorTab,
			enabled: true,
			run: openInEditorHandler,
		},
	];

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
							ariaLabel={reload}
							icon={ThemeIcon.fromId('refresh')}
							tooltip={reload}
							onPressed={reloadHandler} />
						<ActionBarMenuButton
							actions={openInActions}
							align='right'
							ariaLabel={openInDropdownLabel}
							dropdownAriaLabel={openInDropdownLabel}
							dropdownIndicator='enabled-split'
							dropdownTooltip={openInDropdownLabel}
							icon={ThemeIcon.fromId('positron-open-in-new-window')}
							tooltip={openInDropdownLabel} />
						<ActionBarSeparator />
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
