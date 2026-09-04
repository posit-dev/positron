/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './actionBars.css';

// React.
import { FormEvent, KeyboardEvent, PropsWithChildren, useEffect, useMemo, useRef, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { IAction } from '../../../../../base/common/actions.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { IReactComponentContainer } from '../../../../../base/browser/positronReactRenderer.js';
import { PositronActionBar } from '../../../../../platform/positronActionBar/browser/positronActionBar.js';
import { ActionBarButton } from '../../../../../platform/positronActionBar/browser/components/actionBarButton.js';
import { ActionBarRegion } from '../../../../../platform/positronActionBar/browser/components/actionBarRegion.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { ActionBarSeparator } from '../../../../../platform/positronActionBar/browser/components/actionBarSeparator.js';
import { ActionBarMenuButton } from '../../../../../platform/positronActionBar/browser/components/actionBarMenuButton.js';
import { PositronActionBarContextProvider } from '../../../../../platform/positronActionBar/browser/positronActionBarContext.js';
import { HelpTopicSuggestion } from '../../../../services/languageRuntime/common/positronHelpComm.js';

// Constants.
const kSecondaryActionBarGap = 4;
const kPaddingLeft = 8;
const kPaddingRight = 8;

// Localized strings.
const tooltipPreviousTopic = localize('positronPreviousTopic', "Previous topic");
const tooltipNextTopic = localize('positronNextTopic', "Next topic");
const tooltipShowPositronHelp = localize('positronShowPositronHelp', "Show Positron help");
const tooltipHelpHistory = localize('positronHelpHistory', "Help history");
const clearHelpSearch = localize('positronHelpSearch.clear', "Clear help search");
const noHelpSearchRuntime = localize('positronHelpSearch.noRuntime', "Start an interpreter to search help");

const kMaximumSuggestions = 50;

const HelpSearch = () => {
	const services = usePositronReactServicesContext();
	const cache = useRef(new Map<string, HelpTopicSuggestion[]>());
	const [foregroundSession, setForegroundSession] = useState(services.runtimeSessionService.foregroundSession);
	const [query, setQuery] = useState('');
	const [topics, setTopics] = useState<HelpTopicSuggestion[]>([]);
	const [focused, setFocused] = useState(false);
	const [activeIndex, setActiveIndex] = useState(-1);
	const [submitting, setSubmitting] = useState(false);

	useEffect(() => {
		const disposable = services.runtimeSessionService.onDidChangeForegroundSession(session => {
			setForegroundSession(session);
			setTopics([]);
			setActiveIndex(-1);
		});
		return () => disposable.dispose();
	}, [services.runtimeSessionService]);

	useEffect(() => {
		if (!focused || !foregroundSession) {
			return;
		}
		const cached = cache.current.get(foregroundSession.sessionId);
		if (cached) {
			setTopics(cached);
			return;
		}
		let cancelled = false;
		void services.positronHelpService.getHelpTopics().then(result => {
			if (!cancelled) {
				cache.current.set(foregroundSession.sessionId, result);
				setTopics(result);
			}
		}).catch(() => { /* Search remains available without suggestions. */ });
		return () => { cancelled = true; };
	}, [focused, foregroundSession, services.positronHelpService]);

	const suggestions = useMemo(() => {
		const normalized = query.trim().toLocaleLowerCase();
		if (!normalized) {
			return [];
		}
		return topics
			.filter(topic => topic.label.toLocaleLowerCase().includes(normalized))
			.sort((left, right) => {
				const leftLabel = left.label.toLocaleLowerCase();
				const rightLabel = right.label.toLocaleLowerCase();
				const leftRank = leftLabel === normalized ? 0 : leftLabel.startsWith(normalized) ? 1 : 2;
				const rightRank = rightLabel === normalized ? 0 : rightLabel.startsWith(normalized) ? 1 : 2;
				return leftRank - rightRank || leftLabel.localeCompare(rightLabel);
			})
			.slice(0, kMaximumSuggestions);
	}, [query, topics]);

	const runSearch = async (topic?: HelpTopicSuggestion) => {
		const value = query.trim();
		if ((!value && !topic) || submitting) {
			return;
		}
		setSubmitting(true);
		setActiveIndex(-1);
		setFocused(false);
		try {
			const shown = topic
				? await services.positronHelpService.showHelpTopicForForegroundSession(topic.topic)
				: await services.positronHelpService.searchHelp(value);
			if (!shown) {
				services.notificationService.info(localize('positronHelpSearch.unavailable', "Help search is unavailable for the active interpreter."));
			}
		} catch (error) {
			services.notificationService.warn(localize('positronHelpSearch.error', "An error occurred while searching help: {0}", error.message));
		} finally {
			setSubmitting(false);
		}
	};

	const onSubmit = (event: FormEvent) => {
		event.preventDefault();
		void runSearch(activeIndex >= 0 ? suggestions[activeIndex] : undefined);
	};

	const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === 'ArrowDown' && suggestions.length) {
			event.preventDefault();
			setActiveIndex(index => Math.min(index + 1, suggestions.length - 1));
		} else if (event.key === 'ArrowUp' && suggestions.length) {
			event.preventDefault();
			setActiveIndex(index => Math.max(index - 1, -1));
		} else if (event.key === 'Escape') {
			setActiveIndex(-1);
			setFocused(false);
		}
	};

	const languageName = foregroundSession?.runtimeMetadata.languageName;
	const placeholder = languageName
		? localize('positronHelpSearch.placeholder', "Search {0} Help", languageName)
		: noHelpSearchRuntime;
	const listId = 'positron-help-search-suggestions';

	return (
		<form className='help-search' onSubmit={onSubmit}>
			<span className={ThemeIcon.asClassName(ThemeIcon.fromId('search'))} />
			<input
				aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
				aria-autocomplete='list'
				aria-controls={listId}
				aria-expanded={focused && suggestions.length > 0}
				aria-label={placeholder}
				autoComplete='off'
				disabled={!foregroundSession || submitting}
				placeholder={placeholder}
				role='combobox'
				value={query}
				onBlur={() => window.setTimeout(() => setFocused(false), 100)}
				onChange={event => { setQuery(event.target.value); setActiveIndex(-1); }}
				onFocus={() => setFocused(true)}
				onKeyDown={onKeyDown}
			/>
			{query && <button aria-label={clearHelpSearch} type='button' onClick={() => setQuery('')}>
				<span className={ThemeIcon.asClassName(ThemeIcon.fromId('close'))} />
			</button>}
			{focused && suggestions.length > 0 && <div className='help-search-suggestions' id={listId} role='listbox'>
				{suggestions.map((suggestion, index) => <button
					aria-selected={index === activeIndex}
					className={index === activeIndex ? 'active' : undefined}
					id={`${listId}-${index}`}
					key={suggestion.topic}
					role='option'
					type='button'
					onMouseDown={event => event.preventDefault()}
					onClick={() => void runSearch(suggestion)}
				>
					<span>{suggestion.label}</span>
					{suggestion.detail && <span className='detail'>{suggestion.detail}</span>}
				</button>)}
			</div>}
		</form>
	);
};

/**
 * Shortens a URL.
 * @param url The URL.
 * @returns The shortened URL.
 */
const shortenUrl = (url: string) => url.replace(new URL(url).origin, '');

/**
 * ActionBarsProps interface.
 */
export interface ActionBarsProps {
	reactComponentContainer: IReactComponentContainer;
	onHome: () => void;
}

/**
 * ActionBars component.
 * @param props A ActionBarsProps that contains the component properties.
 * @returns The rendered component.
 */
export const ActionBars = (props: PropsWithChildren<ActionBarsProps>) => {
	// Context hooks.
	const services = usePositronReactServicesContext();

	// State hooks.
	const [canNavigateBackward, setCanNavigateBackward] = useState(services.positronHelpService.canNavigateBackward);
	const [canNavigateForward, setCanNavigateForward] = useState(services.positronHelpService.canNavigateForward);
	const [currentHelpEntry, setCurrentHelpEntry] = useState(services.positronHelpService.currentHelpEntry);
	const [currentHelpTitle, setCurrentHelpTitle] = useState(services.positronHelpService.currentHelpEntry?.title);

	/**
	 * Returns the help history actions.
	 * @returns The help history actions.
	 */
	const helpHistoryActions = () => {
		// Build the help history actions.
		const actions: IAction[] = [];
		const currentHelpEntry = services.positronHelpService.currentHelpEntry;
		const helpEntries = services.positronHelpService.helpEntries;
		for (let helpEntryIndex = helpEntries.length - 1; helpEntryIndex >= 0; helpEntryIndex--) {
			actions.push({
				id: generateUuid(),
				label: helpEntries[helpEntryIndex].title || shortenUrl(helpEntries[helpEntryIndex].targetUrl),
				tooltip: '',
				class: undefined,
				enabled: true,
				checked: helpEntries[helpEntryIndex] === currentHelpEntry,
				run: () => {
					services.positronHelpService.openHelpEntryIndex(helpEntryIndex);
				}
			});
		}

		// Return the help history actions.
		return actions;
	};

	// Main useEffect.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add the onSizeChanged event handler.
		disposableStore.add(props.reactComponentContainer.onSizeChanged(size => {
			// setAlternateFindUI(size.width - kPaddingLeft - historyButtonRef.current.offsetWidth - kSecondaryActionBarGap < 180);
		}));

		// Add the onDidChangeCurrentHelpEntry event handler.
		disposableStore.add(
			services.positronHelpService.onDidChangeCurrentHelpEntry(currentHelpEntry => {
				// Set the current help entry and the current help title.
				setCurrentHelpEntry(currentHelpEntry);
				setCurrentHelpTitle(currentHelpEntry?.title);

				// Update navigation state.
				setCanNavigateBackward(services.positronHelpService.canNavigateBackward);
				setCanNavigateForward(services.positronHelpService.canNavigateForward);
			})
		);

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, [services.positronHelpService, props.reactComponentContainer]);

	// useEffect for currentHelpEntry.
	useEffect(() => {
		// If there isn't a current help entry, no further action is required.
		if (!currentHelpEntry) {
			return;
		}

		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add the onDidChangeTitle event handler.
		disposableStore.add(currentHelpEntry.onDidChangeTitle(() => {
			// Set the current help title.
			setCurrentHelpTitle(currentHelpEntry.title);
		}));

		// Return the cleanup function.
		return () => disposableStore.dispose();
	}, [currentHelpEntry]);

	// Render.
	return (
		<div className='action-bars'>
			<PositronActionBarContextProvider {...props}>
				<PositronActionBar
					borderBottom={true}
					paddingLeft={kPaddingLeft}
					paddingRight={kPaddingRight}
				>
					<ActionBarRegion location='left'>
						<ActionBarButton
							ariaLabel={tooltipPreviousTopic}
							disabled={!canNavigateBackward}
							icon={ThemeIcon.fromId('positron-left-arrow')}
							tooltip={tooltipPreviousTopic}
							onPressed={() => services.positronHelpService.navigateBackward()}
						/>
						<ActionBarButton
							ariaLabel={tooltipNextTopic}
							disabled={!canNavigateForward}
							icon={ThemeIcon.fromId('positron-right-arrow')}
							tooltip={tooltipNextTopic}
							onPressed={() => services.positronHelpService.navigateForward()}
						/>

						<ActionBarSeparator />

						<ActionBarButton
							ariaLabel={tooltipShowPositronHelp}
							disabled={props.onHome === undefined}
							icon={ThemeIcon.fromId('positron-home')}
							tooltip={tooltipShowPositronHelp}
							onPressed={() => props.onHome()}
						/>
					</ActionBarRegion>
					<ActionBarRegion location='right' minWidth={0}>
						<HelpSearch />
					</ActionBarRegion>

					{/* <ActionBarSeparator /> */}
					{/* <ActionBarButton
						iconId='positron-open-in-new-window'
						tooltip={localize('positronShowInNewWindow', "Show in new window")}
					/> */}

				</PositronActionBar>
				<PositronActionBar
					borderBottom={true}
					gap={kSecondaryActionBarGap}
					paddingLeft={kPaddingLeft}
					paddingRight={kPaddingRight}
				>
					<ActionBarRegion location='left'>
						{currentHelpTitle &&
							<ActionBarMenuButton
								actions={helpHistoryActions}
								label={currentHelpTitle}
								tooltip={tooltipHelpHistory}
							/>
						}
					</ActionBarRegion>
					<ActionBarRegion location='right'>
						<ActionBarButton
							align='right'
							ariaLabel={tooltipShowPositronHelp}
							disabled={currentHelpEntry === undefined}
							icon={ThemeIcon.fromId('positron-search')}
							tooltip={tooltipShowPositronHelp}
							onPressed={() => currentHelpEntry?.showFind()}
						/>
					</ActionBarRegion>

				</PositronActionBar>
			</PositronActionBarContextProvider>
		</div>
	);
};
