/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import { useEffect, useId, useRef, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../../../nls.js';
import { status } from '../../../../../../base/browser/ui/aria/aria.js';
import { Button } from '../../../../../../base/browser/ui/positronComponents/button/button.js';
import { getIconClassesForLanguageId } from '../../../../../../editor/common/services/getIconClasses.js';
import { EnvironmentHealthLanguage, IHealthItemFix } from '../environmentHealth.js';
import { IEnvironmentHealthEntry } from '../environmentHealthService.js';
import { HealthItemRow } from './healthItemRow.js';

/**
 * The one line that stands in for a whole group, or undefined while it has none.
 *
 * A language that is checking has none: the progress line in the card header is
 * the only busy signal, so nothing here competes with it. A recheck does not pass
 * through that state at all, because the environmentHealthService leaves the previous result in
 * place until the new one lands.
 */
function summaryText(health: IEnvironmentHealthEntry): string | undefined {
	switch (health.state.kind) {
		case 'unavailable':
			return localize('positron.welcome.environmentSetupUnavailable', "The {0} extension is not available.", health.label);
		case 'error':
			return localize('positron.welcome.environmentSetupError', "The {0} check could not be completed.", health.label);
		case 'result': {
			const items = health.state.result.items;
			if (items.every(i => i.status === 'pass')) {
				return localize('positron.welcome.environmentSetupAllPassed', "You have successfully set up {0}", health.label);
			}
			const passed = items.filter(i => i.status === 'pass').length;
			return localize('positron.welcome.environmentSetupSomePassed', "{0} of {1} checks passed", passed, items.length);
		}
		default:
			return undefined;
	}
}

/**
 * True when expanding this language would show something. A first check has
 * nothing yet, and the unavailable and error states say all they have to say in
 * the header, so a chevron there would promise a body that does not exist.
 *
 * A language turned off in the setting never reaches this component: the section
 * leaves it out entirely.
 */
function hasBody(health: IEnvironmentHealthEntry): boolean {
	return health.state.kind === 'result';
}

/** True when this language has something the user might act on. */
function needsAttention(health: IEnvironmentHealthEntry): boolean {
	return health.state.kind === 'result'
		&& !health.state.result.items.every(i => i.status === 'pass');
}

export interface LanguageHealthGroupProps {
	readonly health: IEnvironmentHealthEntry;
	/**
	 * Whether each language group is expanded, for the groups the user opened or
	 * closed themselves. A language with no entry has not been touched, so the
	 * auto-expand rule decides for it.
	 */
	readonly expandedByLanguage: Map<EnvironmentHealthLanguage, boolean>;
	/** Whether this language has a check or a fix running. */
	readonly busy: boolean;
	readonly onRunFix: (fix: IHealthItemFix) => void;
}

/**
 * LanguageHealthGroup component. One language's checks, with its header doubling
 * as the control that shows and hides them.
 * @param props A LanguageHealthGroupProps that contains the component properties.
 * @returns The rendered component.
 */
export const LanguageHealthGroup = ({ health, expandedByLanguage, busy, onRunFix }: LanguageHealthGroupProps) => {
	const headerId = useId();
	// Undefined until the user decides for themselves, so a group opens itself
	// when its results land with something to act on, and stays where the user
	// put it afterwards.
	const [override, setOverride] = useState<boolean | undefined>(() => expandedByLanguage.get(health.language));
	const expanded = override ?? needsAttention(health);
	const toggle = () => {
		expandedByLanguage.set(health.language, !expanded);
		setOverride(!expanded);
	};

	const summary = summaryText(health);

	// `status` speaks through the workbench's polite live region. In an effect
	// because results land seconds after the page paints, and it speaks the line
	// already on screen rather than one written only for screen readers.
	//
	// Keyed on the state object rather than the sentence it produces: a rerun that
	// finds nothing new produces the same sentence, and keying on the text left
	// the control looking dead. The service replaces that object on every run, so
	// this speaks once per run, and skips whatever was already on screen at mount
	// -- the live region is workbench-wide, so a rebuild while the user works in
	// another tab would otherwise read the whole card at them.
	const announced = useRef(health.state);
	useEffect(() => {
		if (announced.current === health.state) {
			return;
		}
		announced.current = health.state;
		if (summary) {
			status(`${health.label}, ${summary}`);
		}
	}, [health.label, health.state, summary]);

	const body = () => {
		if (health.state.kind !== 'result') {
			return null;
		}
		return (
			<ul className='environment-health-item-list'>
				{health.state.result.items.map(i =>
					<HealthItemRow key={i.id} busy={busy} item={i} onRunFix={onRunFix} />)}
			</ul>
		);
	};

	const headerContent = (
		<>
			<span aria-hidden='true' className={`environment-health-group-icon ${getIconClassesForLanguageId(health.language).join(' ')}`} />
			<span className='environment-health-group-name'>{health.label}</span>
			{summary && <span className='environment-health-group-summary'>{summary}</span>}
		</>
	);

	// Render.
	return (
		// `show-file-icons` is required for file icon theme CSS to apply to
		// `.environment-health-group-icon`; see environmentHealthSection.css.
		<div aria-labelledby={headerId} className='environment-health-group show-file-icons' role='group'>
			{/*
				The heading wraps the button rather than the other way round: a
				button's content model has no room for a heading, and this is the
				shape assistive technology expects from a disclosure.
			*/}
			<h3 className='environment-health-group-heading'>
				{hasBody(health)
					? <Button
						ariaExpanded={expanded}
						className='environment-health-group-header'
						id={headerId}
						onPressed={toggle}
					>
						{headerContent}
						<span aria-hidden='true' className={`environment-health-group-chevron codicon codicon-chevron-${expanded ? 'down' : 'right'}`} />
					</Button>
					: <div className='environment-health-group-header' id={headerId}>{headerContent}</div>}
			</h3>
			{hasBody(health) && expanded && body()}
		</div>
	);
};
