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
import { HealthLanguage, IHealthItemFix } from '../environmentHealth.js';
import { ILanguageHealth } from '../environmentHealthService.js';
import { HealthItemRow } from './healthItemRow.js';

/**
 * The one line that stands in for a whole group, or undefined while it has none.
 *
 * A language that is checking has none: the progress line in the card header is
 * the only busy signal, so nothing here competes with it. A recheck does not pass
 * through that state at all, because the tracker leaves the previous result in
 * place until the new one lands.
 */
function summaryText(health: ILanguageHealth): string | undefined {
	switch (health.state.kind) {
		case 'unavailable':
			return localize('positron.welcome.health.unavailable', "The {0} extension is not available.", health.label);
		case 'error':
			return localize('positron.welcome.health.error', "The {0} check could not be completed.", health.label);
		case 'result': {
			const items = health.state.result.items;
			if (items.every(i => i.status === 'pass')) {
				return localize('positron.welcome.health.allPassed', "You have successfully set up {0}", health.label);
			}
			const passed = items.filter(i => i.status === 'pass').length;
			return localize('positron.welcome.health.somePassed', "{0} of {1} checks passed", passed, items.length);
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
function hasBody(health: ILanguageHealth): boolean {
	return health.state.kind === 'result';
}

/** True when this language has something the user might act on. */
function needsAttention(health: ILanguageHealth): boolean {
	return health.state.kind === 'result'
		&& !health.state.result.items.every(i => i.status === 'pass');
}

/**
 * Which groups the user has opened or closed by hand.
 *
 * Kept outside React because the welcome pane throws its React tree away and
 * rebuilds it whenever a walkthrough registers or the tab is revisited, which
 * would otherwise spring a group the user closed back open. The tracker is
 * hoisted out of React for the same reason. Module scope means one window, which
 * is the right lifetime: a choice made in one window should not follow the user
 * into another.
 *
 * Exported only so tests can clear it: it outlives any single component, so
 * without a reset one test's collapsed group would leak into the next.
 */
export const userOverrides = new Map<HealthLanguage, boolean>();

export interface LanguageHealthGroupProps {
	readonly health: ILanguageHealth;
	readonly onRunFix: (fix: IHealthItemFix) => void;
}

/**
 * LanguageHealthGroup component. One language's checks, with its header doubling
 * as the control that shows and hides them.
 * @param props A LanguageHealthGroupProps that contains the component properties.
 * @returns The rendered component.
 */
export const LanguageHealthGroup = ({ health, onRunFix }: LanguageHealthGroupProps) => {
	const headerId = useId();
	// Undefined until the user decides for themselves, so a group opens itself
	// when its results land with something to act on, and stays where the user
	// put it afterwards.
	const [override, setOverride] = useState<boolean | undefined>(() => userOverrides.get(health.language));
	const expanded = override ?? needsAttention(health);
	const toggle = () => {
		userOverrides.set(health.language, !expanded);
		setOverride(!expanded);
	};

	const summary = summaryText(health);

	// Results land seconds after the page paints, so a screen reader user would
	// otherwise never hear them. This announces the line already on screen rather
	// than a string written only for screen readers.
	//
	// Keyed on the state object, not on the wording it produces. A recheck that
	// finds nothing new produces the same sentence, so keying on the text alone
	// skipped the announcement and left Recheck looking dead to a screen reader
	// user. The tracker stores one state object per language and replaces it on
	// every run, so this speaks once per run and a run for one language does not
	// re-announce the other.
	//
	// Whatever is already on screen at mount was announced when it landed, and
	// the live region is workbench-wide rather than per pane. Without this, a
	// rebuild while the user works in another tab reads the whole card at them.
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
			<ul className='health-item-list'>
				{health.state.result.items.map(i =>
					<HealthItemRow key={i.id} item={i} onRunFix={onRunFix} />)}
			</ul>
		);
	};

	const headerContent = (
		<>
			<span aria-hidden='true' className={`health-group-icon ${getIconClassesForLanguageId(health.language).join(' ')}`} />
			<span className='health-group-name'>{health.label}</span>
			{summary && <span className='health-group-summary'>{summary}</span>}
		</>
	);

	// Render.
	return (
		// `show-file-icons` is required for file icon theme CSS to apply to
		// `.health-group-icon`; see environmentHealthSection.css.
		<div aria-labelledby={headerId} className='health-group show-file-icons' role='group'>
			{/*
				The heading wraps the button rather than the other way round: a
				button's content model has no room for a heading, and this is the
				shape assistive technology expects from a disclosure.
			*/}
			<h4 className='health-group-heading'>
				{hasBody(health)
					? <Button
						ariaExpanded={expanded}
						className='health-group-header'
						id={headerId}
						onPressed={toggle}
					>
						{headerContent}
						<span aria-hidden='true' className={`health-group-chevron codicon codicon-chevron-${expanded ? 'down' : 'right'}`} />
					</Button>
					: <div className='health-group-header' id={headerId}>{headerContent}</div>}
			</h4>
			{hasBody(health) && expanded && body()}
		</div>
	);
};
