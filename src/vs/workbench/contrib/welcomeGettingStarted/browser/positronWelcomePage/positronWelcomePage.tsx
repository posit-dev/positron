/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './positronWelcomePage.css';

// React.
import { useEffect } from 'react';

// Other dependencies.
import { PositronReactRenderer } from '../../../../../base/browser/positronReactRenderer.js';
import { DomSlot } from './components/domSlot.js';
import { EnvironmentHealthSection } from './components/environmentHealthSection.js';
import { WalkthroughBanner } from './components/walkthroughBanner.js';
import { WelcomeHeader } from './components/welcomeHeader.js';
import { EnvironmentHealthLanguage } from './environmentHealth.js';
import { IEnvironmentHealthService } from './environmentHealthService.js';

/**
 * PositronWelcomePageProps interface.
 */
export interface PositronWelcomePageProps {
	/**
	 * The "Recent" list. Built by the editor pane because it reuses the
	 * existing GettingStartedIndexList widget.
	 */
	readonly recentList: HTMLElement;

	/**
	 * The "Connect to..." action. Built by the editor pane. Undefined on web,
	 * where there is nothing to connect to.
	 */
	readonly connectAction?: HTMLElement;

	/**
	 * The "Show welcome page on startup" checkbox row. Built by the editor pane
	 * because it reuses the existing Toggle widget and its telemetry.
	 */
	readonly footer: HTMLElement;

	/**
	 * Runs the environment health checks and holds their results. Built by the
	 * editor pane, because it has to outlive this component: the pane rebuilds
	 * the React tree whenever a walkthrough registers.
	 */
	readonly environmentHealthService: IEnvironmentHealthService;

	/**
	 * Whether each language group is expanded, for the groups the user opened or
	 * closed themselves. A language with no entry has not been touched, so the
	 * auto-expand rule decides for it.
	 */
	readonly expandedByLanguage: Map<EnvironmentHealthLanguage, boolean>;

	/**
	 * Called once the page is in the DOM. The editor pane uses this to attach
	 * click handlers to the elements above, which it can only do after React
	 * has mounted them.
	 */
	readonly onDidMount: () => void;
}

/**
 * PositronWelcomePage component. The redesigned welcome page, shown when the
 * `welcomePage.experimental` setting is on.
 * @param props A PositronWelcomePageProps that contains the component properties.
 * @returns The rendered component.
 */
export const PositronWelcomePage = (props: PositronWelcomePageProps) => {
	const onDidMount = props.onDidMount;

	// Runs after the DomSlot layout effects, so the slotted elements are in the
	// DOM by the time the editor pane wires up its click handlers.
	useEffect(() => {
		onDidMount();
	}, [onDidMount]);

	// A fragment, not a wrapping div. createPositronWelcomePage puts the
	// `positron-welcome-page` class on the container React roots into, so the
	// layout lives on one element instead of two nested ones.
	return (
		<>
			<WelcomeHeader />
			<EnvironmentHealthSection environmentHealthService={props.environmentHealthService} expandedByLanguage={props.expandedByLanguage} />
			<WalkthroughBanner />
			<DomSlot element={props.recentList} />
			{props.connectAction && <DomSlot element={props.connectAction} />}
			<DomSlot className='positron-welcome-page-footer' element={props.footer} />
		</>
	);
};

/**
 * Renders the Positron welcome page into a container. The container becomes the
 * page's layout element, so the caller can pass a bare div.
 * @param container The container HTMLElement.
 * @param props A PositronWelcomePageProps that contains the component properties.
 * @returns The PositronReactRenderer. Dispose it to unmount the page.
 */
export const createPositronWelcomePage = (
	container: HTMLElement,
	props: PositronWelcomePageProps
): PositronReactRenderer => {
	container.classList.add('positron-welcome-page');
	const renderer = new PositronReactRenderer(container);
	renderer.render(<PositronWelcomePage {...props} />);
	return renderer;
};
