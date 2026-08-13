/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './walkthroughBanner.css';

// React.
import { useId } from 'react';

// Other dependencies.
import { localize } from '../../../../../../nls.js';
import { Button } from '../../../../../../base/browser/ui/positronComponents/button/button.js';
import { usePositronReactServicesContext } from '../../../../../../base/browser/positronReactRendererContext.js';
import type { GettingStartedActionClassification, GettingStartedActionEvent } from '../../gettingStarted.js';
import { IWalkthroughsService } from '../../gettingStartedService.js';

/**
 * WalkthroughBanner component. Points users at the walkthroughs.
 * @returns The rendered component, or null when there are none to show.
 */
export const WalkthroughBanner = () => {
	const services = usePositronReactServicesContext();
	const headingId = useId();

	// Read during render rather than tracked with listeners: the editor pane
	// rebuilds the whole page when a walkthrough is added or removed, and that
	// remounts this component. The `when` clause is the same filter the quick
	// pick applies, so the banner cannot show while the list would be empty.
	const hasWalkthroughs = services.get(IWalkthroughsService).getWalkthroughs()
		.some(walkthrough => services.contextKeyService.contextMatchesRules(walkthrough.when));

	if (!hasWalkthroughs) {
		return null;
	}

	const showAllWalkthroughs = () => {
		services.telemetryService.publicLog2<GettingStartedActionEvent, GettingStartedActionClassification>(
			'gettingStarted.ActionExecuted',
			{
				command: 'welcomeBannerSeeAllWalkthroughs',
				argument: undefined,
				walkthroughId: undefined,
			});

		services.commandService.executeCommand('welcome.showAllWalkthroughs');
	};

	// Render.
	return (
		<section aria-labelledby={headingId} className='positron-welcome-page-walkthrough-banner'>
			<span aria-hidden='true' className='walkthrough-banner-icon codicon codicon-mortar-board' />
			<div className='walkthrough-banner-text'>
				<h3 className='walkthrough-banner-label' id={headingId}>
					{localize('positron.welcome.learn', "Learn")}
				</h3>
				<p className='walkthrough-banner-description'>
					{localize(
						'positron.welcome.walkthroughBannerDescription',
						"Take a guided tour of Positron without leaving the IDE. Start with the basics, or see what's different if you're coming from RStudio or VS Code."
					)}
				</p>
				<Button
					className='walkthrough-banner-link positron-welcome-page-link'
					onPressed={showAllWalkthroughs}
				>
					{localize('positron.welcome.seeAllWalkthroughs', "See all walkthroughs")}
					<span aria-hidden='true' className='walkthrough-banner-arrow codicon codicon-arrow-right' />
				</Button>
			</div>
		</section>
	);
};
