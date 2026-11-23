/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './getStartedCard.css';

// React.
import { useEffect, useId, useRef, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../../../nls.js';
import { Button } from '../../../../../../base/browser/ui/positronComponents/button/button.js';
import { useEventState } from '../../../../../../base/browser/ui/react/useEventState.js';
import { usePositronReactServicesContext } from '../../../../../../base/browser/positronReactRendererContext.js';
import { StorageScope, StorageTarget } from '../../../../../../platform/storage/common/storage.js';
import type { GettingStartedActionClassification, GettingStartedActionEvent } from '../../gettingStarted.js';
import { IPositronLayoutService } from '../../../../../services/positronLayout/browser/interfaces/positronLayoutService.js';
import { positronSimplifiedLayout } from '../../../../../services/positronLayout/browser/layouts/positronSimplifiedLayout.js';
import { EnvironmentHealthLanguage } from '../environmentHealth.js';
import { IEnvironmentHealthEntry, IEnvironmentHealthService } from '../environmentHealthService.js';
import { IAgentSetupState, WelcomeAgentSetup } from '../welcomeAgentSetup.js';
import { AgentSetupSection, isAssistantReady } from './agentSetupSection.js';
import { EnvironmentHealthSection } from './environmentHealthSection.js';
import { getLayoutCards, LayoutCardList } from './layoutCards.js';

/**
 * Remembers that the user finished or skipped setup, so the card shows as one
 * summary line. Profile scope, so it holds in every folder.
 */
const SETUP_DONE_STORAGE_KEY = 'positron.welcome.getStarted.done';

type GetStartedStep = 'environment' | 'assistant' | 'layout';

/**
 * GetStartedCardProps interface.
 */
export interface GetStartedCardProps {
	readonly environmentHealthService: IEnvironmentHealthService;
	readonly expandedByLanguage: Map<EnvironmentHealthLanguage, boolean>;
	readonly agentSetup: WelcomeAgentSetup;
}

/**
 * GetStartedCard component. Walks a new user through setup one step at a time:
 * check the environment, set up AI agents, then pick a layout. Layout comes last
 * because applying it changes what is on screen. Once the user finishes or skips,
 * the card shrinks to a one-line summary.
 * @param props A GetStartedCardProps that contains the component properties.
 * @returns The rendered component.
 */
export const GetStartedCard = (props: GetStartedCardProps) => {
	const services = usePositronReactServicesContext();
	const titleId = useId();
	const titleRef = useRef<HTMLHeadingElement>(null);
	const layoutService = services.get(IPositronLayoutService);

	const [done, setDone] = useState(() =>
		services.storageService.getBoolean(SETUP_DONE_STORAGE_KEY, StorageScope.PROFILE, false));
	const [stepId, setStepId] = useState<GetStartedStep>('environment');
	const [selectedLayoutId, setSelectedLayoutId] = useState<string | undefined>(undefined);

	const languages = useEventState(props.environmentHealthService.onDidChange, () => props.environmentHealthService.state);
	const currentLayoutId = useEventState(layoutService.onDidChangeCurrentLayout, () => layoutService.currentLayoutId);
	const agentSetup = useEventState(props.agentSetup.onDidChange, () => props.agentSetup.state);

	// A step shows only when it has something in it: no languages checked means no
	// environment step, and AI features off means no AI step.
	const steps: GetStartedStep[] = [];
	if (languages.some(language => language.state.kind !== 'hidden')) {
		steps.push('environment');
	}
	if (agentSetup.aiEnabled) {
		steps.push('assistant');
	}
	steps.push('layout');
	const step = steps.includes(stepId) ? stepId : steps[0];
	const stepIndex = steps.indexOf(step);

	// Moves focus to the new step's title, so a keyboard or screen reader user
	// lands at the top of what changed. Not on the first render, which would pull
	// focus onto the welcome page whenever it opens.
	const firstRender = useRef(true);
	useEffect(() => {
		if (firstRender.current) {
			firstRender.current = false;
			return;
		}
		titleRef.current?.focus();
	}, [step]);

	const log = (command: string, argument?: string) =>
		services.telemetryService.publicLog2<GettingStartedActionEvent, GettingStartedActionClassification>(
			'gettingStarted.ActionExecuted',
			{ command, argument, walkthroughId: undefined });

	const markDone = (value: boolean) => {
		setDone(value);
		if (value) {
			services.storageService.store(SETUP_DONE_STORAGE_KEY, true, StorageScope.PROFILE, StorageTarget.USER);
		} else {
			services.storageService.remove(SETUP_DONE_STORAGE_KEY, StorageScope.PROFILE);
		}
	};

	// The layout picked in the last step: the user's pick, else the layout the
	// window is in, else Simplified.
	const layoutToApply = selectedLayoutId ?? currentLayoutId ?? positronSimplifiedLayout.id;

	const finish = () => {
		log('welcomeGetStartedFinish', layoutToApply);
		if (layoutToApply !== currentLayoutId) {
			services.commandService.executeCommand(layoutToApply);
		}
		markDone(true);
	};

	const skip = () => {
		log('welcomeGetStartedSkip', step);
		markDone(true);
	};

	const review = () => {
		log('welcomeGetStartedReview');
		setStepId(steps[0]);
		setSelectedLayoutId(undefined);
		markDone(false);
	};

	if (done) {
		return <GetStartedSummary agentSetup={agentSetup} currentLayoutId={currentLayoutId} languages={languages} onReview={review} />;
	}

	const stepText = getStepText(step);

	// Render.
	return (
		<section aria-labelledby={titleId} className='positron-welcome-page-get-started'>
			<div className='get-started-header'>
				<span className='get-started-label'>
					{localize('positron.welcome.getStarted', "Get Started")}
				</span>
				<span className='get-started-step-count'>
					{localize('positron.welcome.getStartedStepCount', "Step {0} of {1}", stepIndex + 1, steps.length)}
				</span>
				<Button className='get-started-skip positron-welcome-page-link' onPressed={skip}>
					{localize('positron.welcome.getStartedSkip', "Skip setup")}
				</Button>
			</div>
			<h2 ref={titleRef} className='get-started-title' id={titleId} tabIndex={-1}>
				{stepText.title}
			</h2>
			<p className='get-started-description'>{stepText.description}</p>
			<div className='get-started-body'>
				{step === 'environment' &&
					<EnvironmentHealthSection
						environmentHealthService={props.environmentHealthService}
						expandedByLanguage={props.expandedByLanguage}
						labelledBy={titleId}
					/>
				}
				{step === 'assistant' &&
					<AgentSetupSection agentSetup={props.agentSetup} labelledBy={titleId} />
				}
				{step === 'layout' &&
					<LayoutCardList
						currentLayoutId={currentLayoutId}
						labelledBy={titleId}
						selectedLayoutId={layoutToApply}
						onSelect={setSelectedLayoutId}
					/>
				}
			</div>
			<div className='get-started-footer'>
				<ol aria-label={localize('positron.welcome.getStartedProgress', "Setup steps")} className='get-started-progress'>
					{steps.map((s, index) => (
						<li
							key={s}
							aria-current={s === step ? 'step' : undefined}
							className={index <= stepIndex ? 'get-started-progress-step reached' : 'get-started-progress-step'}
						>
							{getStepText(s).label}
						</li>
					))}
				</ol>
				<div className='get-started-buttons'>
					<Button
						className='get-started-button secondary'
						disabled={stepIndex === 0}
						onPressed={() => setStepId(steps[stepIndex - 1])}
					>
						{localize('positron.welcome.getStartedBack', "Back")}
					</Button>
					{stepIndex < steps.length - 1
						? <Button className='get-started-button primary' onPressed={() => setStepId(steps[stepIndex + 1])}>
							{localize('positron.welcome.getStartedNext', "Next")}
						</Button>
						: <Button className='get-started-button primary' onPressed={finish}>
							{localize('positron.welcome.getStartedFinish', "Finish")}
						</Button>
					}
				</div>
			</div>
		</section>
	);
};

/**
 * The words shown for a step.
 * @param step The step.
 * @returns The step's title, description, and short label for the progress bar.
 */
function getStepText(step: GetStartedStep): { title: string; description: string; label: string } {
	switch (step) {
		case 'environment':
			return {
				title: localize('positron.welcome.getStartedEnvironmentTitle', "Check your environment"),
				description: localize('positron.welcome.getStartedEnvironmentDescription', "Positron looked for Python and R on this computer. Fix anything that needs attention, or move on and come back later."),
				label: localize('positron.welcome.getStartedEnvironmentLabel', "Environment"),
			};
		case 'assistant':
			return {
				title: localize('positron.welcome.getStartedAssistantTitle', "Set up AI agents"),
				description: localize('positron.welcome.getStartedAssistantDescription', "Posit Assistant answers questions about your data, writes code, and fixes errors. Sign in to a model provider to use it, and turn on Positron's MCP server to let other coding agents work in your sessions."),
				label: localize('positron.welcome.getStartedAssistantLabel', "AI"),
			};
		case 'layout':
			return {
				title: localize('positron.welcome.getStartedLayoutTitle', "Choose a layout"),
				description: localize('positron.welcome.getStartedLayoutDescription', "Pick the layout that fits what you are doing. It applies when you click Finish, and you can change it later from Review setup."),
				label: localize('positron.welcome.getStartedLayoutLabel', "Layout"),
			};
	}
}

/**
 * GetStartedSummaryProps interface.
 */
interface GetStartedSummaryProps {
	readonly languages: readonly IEnvironmentHealthEntry[];
	readonly agentSetup: IAgentSetupState;
	readonly currentLayoutId: string | undefined;
	readonly onReview: () => void;
}

/**
 * GetStartedSummary component. One line that sums up setup once it is done, with
 * a button that brings the steps back.
 * @param props A GetStartedSummaryProps that contains the component properties.
 * @returns The rendered component.
 */
const GetStartedSummary = (props: GetStartedSummaryProps) => {
	const layoutName = getLayoutCards().find(card => card.commandId === props.currentLayoutId)?.name
		?? localize('positron.welcome.getStartedCustomLayout', "Custom");

	return (
		<section
			aria-label={localize('positron.welcome.getStartedSummary', "Setup summary")}
			className='positron-welcome-page-get-started summary'
		>
			<ul className='get-started-summary-items'>
				{props.languages.map(language => {
					const summary = summarizeLanguage(language);
					return summary &&
						<li key={language.language} className='get-started-summary-item'>
							<span aria-hidden='true' className={`codicon ${summary.icon}`} />
							{summary.text}
						</li>;
				})}
				{props.agentSetup.aiEnabled &&
					<li className='get-started-summary-item'>
						{isAssistantReady(props.agentSetup)
							? <>
								<span aria-hidden='true' className='codicon codicon-pass-filled get-started-summary-pass' />
								{localize('positron.welcome.getStartedSummaryAssistantReady', "Assistant ready")}
							</>
							: <>
								<span aria-hidden='true' className='codicon codicon-warning get-started-summary-warn' />
								{localize('positron.welcome.getStartedSummaryAssistantNotSetUp', "Assistant: not set up")}
							</>
						}
					</li>
				}
				<li className='get-started-summary-item'>
					<span aria-hidden='true' className='codicon codicon-layout' />
					{localize('positron.welcome.getStartedSummaryLayout', "Layout: {0}", layoutName)}
				</li>
			</ul>
			<Button className='get-started-review positron-welcome-page-link' onPressed={props.onReview}>
				{localize('positron.welcome.getStartedReview', "Review setup")}
			</Button>
		</section>
	);
};

/**
 * Sums up one language's environment check in a few words.
 * @param entry The language's check state.
 * @returns The icon class and text, or undefined when the language is not checked.
 */
function summarizeLanguage(entry: IEnvironmentHealthEntry): { icon: string; text: string } | undefined {
	switch (entry.state.kind) {
		case 'hidden':
			return undefined;
		case 'loading':
			return {
				icon: 'codicon-loading codicon-modifier-spin',
				text: localize('positron.welcome.getStartedSummaryChecking', "{0}: checking", entry.label),
			};
		case 'unavailable':
		case 'error':
			return {
				icon: 'codicon-circle-slash',
				text: localize('positron.welcome.getStartedSummaryNotChecked', "{0}: not checked", entry.label),
			};
		case 'result': {
			const toFix = entry.state.result.items.filter(item => item.status === 'fail' || item.status === 'warn').length;
			if (toFix === 0) {
				return {
					icon: 'codicon-pass-filled get-started-summary-pass',
					text: localize('positron.welcome.getStartedSummaryReady', "{0} ready", entry.label),
				};
			}
			return {
				icon: 'codicon-warning get-started-summary-warn',
				text: toFix === 1
					? localize('positron.welcome.getStartedSummaryOneFix', "{0}: 1 fix left", entry.label)
					: localize('positron.welcome.getStartedSummaryFixes', "{0}: {1} fixes left", entry.label, toFix),
			};
		}
	}
}
