/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './environmentHealthSection.css';

// React.
import { useEffect, useId, useRef, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../../../nls.js';
import { status } from '../../../../../../base/browser/ui/aria/aria.js';
import { Button } from '../../../../../../base/browser/ui/positronComponents/button/button.js';
import { useEventState } from '../../../../../../base/browser/ui/react/useEventState.js';
import { usePositronReactServicesContext } from '../../../../../../base/browser/positronReactRendererContext.js';
import { DisposableStore } from '../../../../../../base/common/lifecycle.js';
import { IHoverManager } from '../../../../../../platform/hover/browser/hoverManager.js';
import { PositronActionBarHoverManager } from '../../../../../../platform/positronActionBar/browser/positronActionBarHoverManager.js';
import { WELCOME_PAGE_ENVIRONMENT_CHECKS_KEY } from '../../../common/positronWelcomePageConfiguration.js';
import { HealthLanguage } from '../environmentHealth.js';
import { IEnvironmentHealthService } from '../environmentHealthService.js';
import { LanguageHealthGroup } from './languageHealthGroup.js';

export interface EnvironmentHealthSectionProps {
	readonly tracker: IEnvironmentHealthService;
	/** See LanguageHealthGroup: one map per welcome page, owned by the pane. */
	readonly expandedOverrides: Map<HealthLanguage, boolean>;
}

/**
 * EnvironmentHealthSection component. The environment setup card.
 * @param props An EnvironmentHealthSectionProps that contains the component properties.
 * @returns The rendered component.
 */
export const EnvironmentHealthSection = ({ tracker, expandedOverrides }: EnvironmentHealthSectionProps) => {
	const services = usePositronReactServicesContext();
	const titleId = useId();
	// One subscription for the whole card, which is why onDidChange carries the
	// whole snapshot rather than the language that moved.
	const health = useEventState(tracker.onDidChange, () => tracker.state);
	const running = health.some(language => tracker.isRunning(language.language));
	// A language removed from the setting renders nothing at all, so the only
	// trace of it is the setting itself.
	const visible = health.filter(language => language.state.kind !== 'hidden');

	// The refresh control is an icon, so its label lives in a tooltip. Built the
	// way the console tab strip builds its own rather than a title attribute,
	// which does not follow the workbench's hover delay or styling.
	const [hoverManager, setHoverManager] = useState<IHoverManager>();
	useEffect(() => {
		const disposables = new DisposableStore();
		setHoverManager(disposables.add(new PositronActionBarHoverManager(
			true,
			services.configurationService,
			services.hoverService
		)));
		return () => disposables.dispose();
	}, [services.configurationService, services.hoverService]);

	// A progressbar is not a live region: it is read only if the user navigates
	// onto it. Without this, pressing Recheck is silent, and the result
	// announcement in LanguageHealthGroup cannot cover the gap -- it speaks when a
	// language's state changes, which tells the user how a run ended but never
	// that one began.
	//
	// Only on the transition into running, and never on the first mount. The pane
	// rebuilds its React tree whenever a walkthrough registers, so announcing on
	// mount would speak at someone working in a different tab. That leaves this
	// saying what it is for: the user pressed Recheck and something happened.
	const wasRunning = useRef(running);
	useEffect(() => {
		if (running && !wasRunning.current) {
			status(localize('positron.welcome.health.checkingStatus', "Checking your environment setup"));
		}
		wasRunning.current = running;
	}, [running]);

	const openSetting = () =>
		services.commandService.executeCommand('workbench.action.openSettings', WELCOME_PAGE_ENVIRONMENT_CHECKS_KEY);

	// Render.
	return (
		<section aria-labelledby={titleId} className='positron-welcome-page-environment-setup'>
			<div className='health-header'>
				<h3 className='health-header-title' id={titleId}>
					{localize('positron.welcome.health.title', "Environment setup")}
				</h3>
				{visible.length > 0 &&
					<Button
						ariaLabel={localize('positron.welcome.health.recheckTooltip', "Run the environment setup checks again")}
						className='health-header-button health-recheck'
						hoverManager={hoverManager}
						tooltip={localize('positron.welcome.health.recheckTooltip', "Run the environment setup checks again")}
						onPressed={() => {
							// `running` mirrors the spinner below, and both come from
							// `tracker.isRunning`. Guarding here keeps the two in lockstep
							// instead of leaning on `refresh`'s own early return, which a
							// test double need not implement.
							if (running) {
								return;
							}
							health.forEach(language => tracker.refresh(language.language));
						}}
					>
						<span aria-hidden='true' className='codicon codicon-refresh' />
					</Button>}
				{/*
					An icon beside the recheck control rather than a link under the card.
					The link read as a call to action for turning the feature off, which
					put it in competition with the fix buttons.
				*/}
				{visible.length > 0 &&
					<Button
						ariaLabel={localize('positron.welcome.health.settingsTooltip', "Choose which languages are checked")}
						className='health-header-button health-settings'
						hoverManager={hoverManager}
						tooltip={localize('positron.welcome.health.settingsTooltip', "Choose which languages are checked")}
						onPressed={openSetting}
					>
						<span aria-hidden='true' className='codicon codicon-gear' />
					</Button>}
				{/*
					Sits on the header's bottom edge, outside the text flow, so starting
					a check cannot shift anything below it. A spinner inside the button
					grew the header and moved the whole card.
				*/}
				{running &&
					<div
						aria-label={localize('positron.welcome.health.checking', "Checking...")}
						className='health-progress'
						role='progressbar'
					/>}
			</div>
			{visible.length === 0
				? <div className='health-group-footer'>
					<p className='health-group-footer-text'>
						{localize('positron.welcome.health.allDisabled', "Environment setup checks are turned off for every language.")}
					</p>
					<Button className='health-group-footer-link' onPressed={openSetting}>
						{localize('positron.welcome.health.turnOnChecks', "You can turn them back on in Settings")}
					</Button>
				</div>
				: visible.map(language =>
					<LanguageHealthGroup
						key={language.language}
						busy={tracker.isRunning(language.language)}
						expandedOverrides={expandedOverrides}
						health={language}
						onRunFix={fix => tracker.runFix(language.language, fix)}
					/>)}
		</section>
	);
};
