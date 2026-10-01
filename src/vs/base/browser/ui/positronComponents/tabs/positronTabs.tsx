/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './positronTabs.css';

// React.
import { KeyboardEvent, ReactNode, useId, useRef, useState } from 'react';

// Other dependencies.
import { Button } from '../button/button.js';
import { positronClassNames } from '../../../../common/positronUtilities.js';

/**
 * PositronTab interface. One tab and the panel it shows.
 */
export interface PositronTab {
	// Identifies the tab among its siblings. Stable across renders, so the selection survives the
	// tab list changing around it.
	readonly id: string;

	// What the tab shows: its name, plus anything carried alongside it (e.g. a count badge).
	readonly label: ReactNode;

	// The tab's accessible name, when the label alone would not read well (e.g. a bare count).
	readonly ariaLabel?: string;

	// The panel the tab shows.
	readonly content: ReactNode;
}

/**
 * PositronTabsProps interface.
 */
export interface PositronTabsProps {
	// The accessible name of the tab list.
	readonly ariaLabel: string;

	// The tabs, in order. The first is selected initially.
	readonly tabs: readonly PositronTab[];

	// An extra class for the root element, for the caller's own spacing.
	readonly className?: string;
}

/**
 * PositronTabs component. A horizontal tab strip over a set of panels, for editor pages that split
 * their content into views (e.g. a package's Overview and Security). Tabs use the WAI-ARIA tabs
 * pattern: arrows wrap, Home/End jump to the ends, and selection follows focus.
 *
 * Every tab's panel is rendered, with the inactive ones hidden, so each tab's `aria-controls`
 * resolves to an element that is really there. That makes the panels cheap to switch between, and
 * is also why selection can follow focus; callers with an expensive panel should hold its content
 * back until it is wanted.
 *
 * If the selected tab goes away (the caller stops offering it), the first tab is shown instead.
 */
export const PositronTabs = ({ ariaLabel, tabs, className }: PositronTabsProps) => {
	const [selectedTabId, setSelectedTabId] = useState<string | undefined>(() => tabs[0]?.id);
	const activeTab = tabs.find(tab => tab.id === selectedTabId) ?? tabs[0];

	// Ids wire each tab to its panel. `useId` keeps them distinct when two pages with tabs are open
	// side by side.
	const idPrefix = useId();
	const tabId = (id: string) => `${idPrefix}-tab-${id}`;
	const panelId = (id: string) => `${idPrefix}-panel-${id}`;

	const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

	const handleTabKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
		const index = tabs.indexOf(activeTab);
		let nextIndex: number | undefined;
		switch (e.code) {
			case 'ArrowRight':
				nextIndex = (index + 1) % tabs.length;
				break;
			case 'ArrowLeft':
				nextIndex = (index - 1 + tabs.length) % tabs.length;
				break;
			case 'Home':
				nextIndex = 0;
				break;
			case 'End':
				nextIndex = tabs.length - 1;
				break;
		}
		if (nextIndex === undefined) {
			return;
		}
		// Consume the key before the Button's own Enter/Space handling sees it.
		e.preventDefault();
		e.stopPropagation();
		const nextTab = tabs[nextIndex];
		setSelectedTabId(nextTab.id);
		tabRefs.current[nextTab.id]?.focus();
	};

	return (
		<div className={positronClassNames('positron-tabs', className)}>
			<div aria-label={ariaLabel} className='positron-tabs-list' role='tablist'>
				{tabs.map(tab => {
					const selected = tab === activeTab;
					return (
						<Button
							key={tab.id}
							ref={element => { tabRefs.current[tab.id] = element; }}
							ariaControls={panelId(tab.id)}
							ariaLabel={tab.ariaLabel}
							ariaSelected={selected}
							className={positronClassNames('positron-tab', { active: selected })}
							id={tabId(tab.id)}
							role='tab'
							tabIndex={selected ? 0 : -1}
							onKeyDown={handleTabKeyDown}
							onPressed={() => setSelectedTabId(tab.id)}
						>
							{tab.label}
						</Button>
					);
				})}
			</div>
			{tabs.map(tab =>
				<div
					key={tab.id}
					aria-labelledby={tabId(tab.id)}
					className='positron-tabs-panel'
					hidden={tab !== activeTab}
					id={panelId(tab.id)}
					role='tabpanel'
					tabIndex={0}
				>
					{tab.content}
				</div>
			)}
		</div>
	);
};
