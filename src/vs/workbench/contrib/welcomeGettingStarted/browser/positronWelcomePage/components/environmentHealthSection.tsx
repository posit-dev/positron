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
import { EnvironmentHealthLanguage } from '../environmentHealth.js';
import { IEnvironmentHealthService } from '../environmentHealthService.js';
import { LanguageHealthGroup } from './languageHealthGroup.js';

export interface EnvironmentHealthSectionProps {
	readonly environmentHealthService: IEnvironmentHealthService;
	/** See LanguageHealthGroup: one map per welcome page, owned by the pane. */
	readonly expandedByLanguage: Map<EnvironmentHealthLanguage, boolean>;
}

/**
 * EnvironmentHealthSection component. The environment setup card.
 * @param props An EnvironmentHealthSectionProps that contains the component properties.
 * @returns The rendered component.
 */
export const EnvironmentHealthSection = ({ environmentHealthService, expandedByLanguage }: EnvironmentHealthSectionProps) => {
	const services = usePositronReactServicesContext();
	// Ties the card's heading to the section, so a screen reader announces the
	// region as "Environment setup" rather than an unnamed region.
	const titleId = useId();
	// useEventState reads the value once, then re-reads it and re-renders whenever
	// the event fires. The service's state is not a React value, so this is how the
	// card follows it.
	const languages = useEventState(environmentHealthService.onDidChange, () => environmentHealthService.state);
	const busy = languages.some(language => environmentHealthService.isBusy(language.language));
	// A language removed from the setting renders nothing at all, so the only
	// trace of it is the setting itself.
	const enabledLanguages = languages.filter(language => language.state.kind !== 'hidden');
	// Every language turned off in the setting.
	const allChecksDisabled = enabledLanguages.length === 0;

	// Built the way the console tab list builds its hovers, so this one follows the
	// workbench's hover delay and styling rather than being a title attribute.
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

	// The busy indicator is not a live region -- a screen reader reads it only if
	// the user navigates onto it -- so starting a run would otherwise be silent.
	// Announced only on the transition into busy, and never on the first mount:
	// the pane rebuilds its React tree whenever a walkthrough registers, and
	// announcing then would speak at someone working in a different tab.
	const wasBusy = useRef(busy);
	useEffect(() => {
		if (busy && !wasBusy.current) {
			status(localize('positron.welcome.environmentSetupCheckingStatus', "Checking your environment setup"));
		}
		wasBusy.current = busy;
	}, [busy]);

	const openSetting = () =>
		services.commandService.executeCommand('workbench.action.openSettings', WELCOME_PAGE_ENVIRONMENT_CHECKS_KEY);

	// Nothing to check and nothing to say. The setting is the only way in and the
	// only way out, so the card leaves no trace on the page. This sits below every
	// hook: turning the last language off re-renders this component, and an early
	// return above them would change its hook count.
	if (allChecksDisabled) {
		return null;
	}

	// Render.
	return (
		<section aria-labelledby={titleId} className='positron-welcome-page-environment-setup'>
			<div className='environment-health-header' data-testid='environment-health-header'>
				<h2 className='environment-health-header-title' id={titleId}>
					{localize('positron.welcome.environmentSetupTitle', "Environment setup")}
				</h2>
				{/*
					Grouped so the pair moves as a unit: see environmentHealthSection.css
					for how the header wraps them below the title, rather than squeezing
					both buttons into whatever sliver is left beside the wrapping text.
				*/}
				<div className='environment-health-header-buttons'>
					<Button
						ariaDisabled={busy}
						ariaLabel={localize('positron.welcome.environmentSetupCheckRerunTooltip', "Run the environment setup checks again")}
						className='environment-health-header-button'
						hoverManager={hoverManager}
						// While anything is running this says why it cannot be pressed.
						// A control that looks pressable and silently does nothing is
						// worse than one that explains itself.
						tooltip={busy
							? localize('positron.welcome.environmentSetupCheckRerunBusyTooltip', "Waiting for the current check to finish")
							: localize('positron.welcome.environmentSetupCheckRerunTooltip', "Run the environment setup checks again")}
						onPressed={() => languages.forEach(language => environmentHealthService.rerunCheckForLanguage(language.language))}
					>
						<span aria-hidden='true' className='codicon codicon-refresh' />
					</Button>
					{/*
						An icon beside the recheck control rather than a link under the
						card. The link read as a call to action for turning the feature
						off, which put it in competition with the fix buttons.
					*/}
					<Button
						ariaLabel={localize('positron.welcome.environmentSetupSettingsTooltip', "Choose which languages are checked")}
						className='environment-health-header-button'
						hoverManager={hoverManager}
						tooltip={localize('positron.welcome.environmentSetupSettingsTooltip', "Choose which languages are checked")}
						onPressed={openSetting}
					>
						<span aria-hidden='true' className='codicon codicon-gear' />
					</Button>
				</div>
			</div>
			{/*
				The box the languages sit in. The title above it is plain text on the
				page, so a theme cannot paint a bar there that outshouts the fix
				buttons in here.
			*/}
			<div className='environment-health-card' data-testid='environment-health-card'>
				{enabledLanguages.map(language =>
					<LanguageHealthGroup
						key={language.language}
						busy={environmentHealthService.isBusy(language.language)}
						expandedByLanguage={expandedByLanguage}
						health={language}
						hoverManager={hoverManager}
						onRunFix={fix => environmentHealthService.runFix(language.language, fix)} />)}
			</div>
		</section>
	);
};
