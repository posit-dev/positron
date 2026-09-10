/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './welcomeHeader.css';

// Other dependencies.
import { localize } from '../../../../../../nls.js';
import { Button } from '../../../../../../base/browser/ui/positronComponents/button/button.js';
import { usePositronReactServicesContext } from '../../../../../../base/browser/positronReactRendererContext.js';
import { URI } from '../../../../../../base/common/uri.js';
import { IProductService } from '../../../../../../platform/product/common/productService.js';
import { IPositronDocsService } from '../../../../../services/positronDocs/browser/positronDocsService.js';
import type { GettingStartedActionClassification, GettingStartedActionEvent } from '../../gettingStarted.js';

const SHOW_RELEASE_NOTES_COMMAND_ID = 'update.showCurrentReleaseNotes';

/**
 * The command the Help view registers to open itself. Reaching the view through
 * its command rather than through IViewsService keeps this page from depending
 * on the positronHelp contribution.
 */
const OPEN_HELP_COMMAND_ID = 'workbench.action.positron.openHelp';

/**
 * WelcomeHeader component. The Positron badge and name, and buttons that open
 * the release notes and Help pane.
 * @returns The rendered component.
 */
export const WelcomeHeader = () => {
	const services = usePositronReactServicesContext();
	const productName = services.get(IProductService).nameLong;

	const openReleaseNotes = async () => {
		try {
			await services.commandService.executeCommand(SHOW_RELEASE_NOTES_COMMAND_ID);
		} catch {
			const docsService = services.get(IPositronDocsService);
			await services.openerService.open(URI.parse(docsService.getUrl('release-notes.html')));
		}
	};

	const openHelp = () => {
		services.telemetryService.publicLog2<GettingStartedActionEvent, GettingStartedActionClassification>(
			'gettingStarted.ActionExecuted',
			{
				command: 'welcomeHeaderOpenHelp',
				argument: undefined,
				walkthroughId: undefined,
			});

		services.commandService.executeCommand(OPEN_HELP_COMMAND_ID);
	};

	// Render.
	return (
		<div className='positron-welcome-page-header'>
			<div className='welcome-header-brand'>
				{/*
					Hidden from screen readers because the heading beside it already
					says the product name.
				*/}
				<div aria-hidden='true' className='welcome-header-icon' />
				<div className='welcome-header-text'>
					{/*
						The page's first heading. The cards below start at h2, so this
						gives the welcome page a top level for a screen reader to land on.
					*/}
					<h1 className='welcome-header-title'>
						{localize('positron.welcome.title', "Welcome to {0}", productName)}
					</h1>
					<p className='welcome-header-tagline'>
						{localize('positron.welcome.tagline', "an IDE for data science from Posit")}
					</p>
				</div>
			</div>
			<div className='welcome-header-actions'>
				<Button className='welcome-header-action' onPressed={openReleaseNotes}>
					<span aria-hidden='true' className='welcome-header-action-icon codicon codicon-megaphone' />
					{localize('positron.welcome.releaseNotes', "Release Notes")}
				</Button>
				<Button className='welcome-header-action welcome-header-help' onPressed={openHelp}>
					<span aria-hidden='true' className='welcome-header-action-icon codicon codicon-question' />
					{localize('positron.welcome.help', "Help")}
				</Button>
			</div>
		</div>
	);
};
