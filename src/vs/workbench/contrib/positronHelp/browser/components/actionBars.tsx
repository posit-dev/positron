/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './actionBars.css';

// React.
import { FormEvent, KeyboardEvent, PropsWithChildren, useEffect, useId, useRef, useState } from 'react';

// Other dependencies.
import { timeout } from '../../../../../base/common/async.js';
import { CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { isCancellationError } from '../../../../../base/common/errors.js';
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
import { PositronActionBarContextProvider, usePositronActionBarContext } from '../../../../../platform/positronActionBar/browser/positronActionBarContext.js';
import { HelpTopicSuggestion } from '../../../../services/languageRuntime/common/positronHelpComm.js';
import { HelpTopicResult } from '../positronHelpService.js';

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
const noHelpSearch = localize('positronHelpSearch.unavailable', "Help search is unavailable for the active interpreter.");
const helpTopics = localize('positronHelpSearch.topics', "Help topics");

const kMaximumSuggestions = 50;
const kSuggestionDelayMs = 200;

/**
 * The Help pane search box. Typing shows topic suggestions; Enter opens the
 * active suggestion or searches the foreground interpreter's help.
 */
const HelpSearch = () => {
	const services = usePositronReactServicesContext();
	const { hoverManager } = usePositronActionBarContext();
	const helpService = services.positronHelpService;
	const [foregroundSession, setForegroundSession] = useState(() => services.runtimeSessionService.foregroundSession);
	const [query, setQuery] = useState('');
	const [topics, setTopics] = useState<HelpTopicSuggestion[]>([]);
	const [focused, setFocused] = useState(false);
	const [activeIndex, setActiveIndex] = useState(-1);
	const [searching, setSearching] = useState(false);
	// Cancels the pending search or topic request.
	const searchCts = useRef<CancellationTokenSource | undefined>(undefined);
	const suggestionsRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const listId = useId();

	useEffect(() => {
		const disposable = services.runtimeSessionService.onDidChangeForegroundSession(session => {
			setForegroundSession(session);
			setTopics([]);
			setActiveIndex(-1);
		});
		return () => disposable.dispose();
	}, [services.runtimeSessionService]);

	// Cancel the pending search when the search box goes away.
	useEffect(() => () => searchCts.current?.dispose(true), []);

	// Request suggestions for the current query. The current list stays until
	// the new one arrives, so the list does not flicker while the user types.
	useEffect(() => {
		const value = query.trim();
		if (!focused || !foregroundSession || !value) {
			setTopics([]);
			setActiveIndex(-1);
			return;
		}
		const cts = new CancellationTokenSource();
		const requestTopics = async () => {
			await timeout(kSuggestionDelayMs, cts.token);
			const result = await helpService.getHelpTopics(value, kMaximumSuggestions, cts.token);
			// The foreground session can change before React cancels this request.
			if (!cts.token.isCancellationRequested && services.runtimeSessionService.foregroundSession === foregroundSession) {
				setTopics(result);
				setActiveIndex(-1);
			}
		};
		// Suggestions are optional. Search still works if they fail.
		requestTopics().catch(() => {
			if (!cts.token.isCancellationRequested) {
				setTopics([]);
				setActiveIndex(-1);
			}
		});
		return () => cts.dispose(true);
	}, [focused, foregroundSession, query, helpService, services.runtimeSessionService]);

	const suggestionsVisible = focused && topics.length > 0;

	// The hovered option goes away without a mouse leave event when the list changes.
	useEffect(() => () => hoverManager?.hideHover(), [hoverManager, suggestionsVisible, topics]);

	useEffect(() => {
		if (suggestionsVisible && activeIndex >= 0) {
			suggestionsRef.current?.children[activeIndex]?.scrollIntoView({ block: 'nearest' });
		}
	}, [activeIndex, suggestionsVisible]);

	const cancelSearch = () => {
		searchCts.current?.dispose(true);
		searchCts.current = undefined;
		setSearching(false);
	};

	const runSearch = async (topic?: HelpTopicSuggestion) => {
		const value = query.trim();
		if (!value && !topic) {
			return;
		}
		cancelSearch();
		const cts = new CancellationTokenSource();
		searchCts.current = cts;
		setSearching(true);
		setActiveIndex(-1);
		setFocused(false);
		try {
			if (topic) {
				const result = await helpService.showHelpTopicForForegroundSession(topic.topic, topic.package, cts.token);
				if (!cts.token.isCancellationRequested && result === HelpTopicResult.NotFound) {
					services.notificationService.info(localize('positronHelpSearch.notFound', "No help found for '{0}'.", topic.topic));
				} else if (!cts.token.isCancellationRequested && result === HelpTopicResult.Unavailable) {
					services.notificationService.info(noHelpSearch);
				}
			} else if (!await helpService.searchHelp(value, cts.token) && !cts.token.isCancellationRequested) {
				services.notificationService.info(noHelpSearch);
			}
		} catch (error) {
			if (!cts.token.isCancellationRequested && !isCancellationError(error)) {
				services.notificationService.warn(localize('positronHelpSearch.error', "An error occurred while searching help: {0}", error.message));
			}
		} finally {
			if (searchCts.current === cts) {
				searchCts.current = undefined;
				setSearching(false);
			}
			cts.dispose();
		}
	};

	const onSubmit = (event: FormEvent) => {
		event.preventDefault();
		void runSearch(suggestionsVisible && activeIndex >= 0 ? topics[activeIndex] : undefined);
	};

	const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			if (suggestionsVisible) {
				setActiveIndex(index => Math.min(index + 1, topics.length - 1));
			} else {
				setFocused(true);
			}
		} else if (event.key === 'ArrowUp' && suggestionsVisible) {
			event.preventDefault();
			setActiveIndex(index => Math.max(index - 1, -1));
		} else if (event.key === 'Escape') {
			cancelSearch();
			setActiveIndex(-1);
			setFocused(false);
		}
	};

	const languageName = foregroundSession?.runtimeMetadata.languageName;
	const placeholder = languageName
		? localize('positronHelpSearch.placeholder', "Search {0} Help", languageName)
		: noHelpSearchRuntime;

	return (
		<form className='help-search' onSubmit={onSubmit}>
			<span className={ThemeIcon.asClassName(ThemeIcon.fromId('search'))} />
			<input
				ref={inputRef}
				aria-activedescendant={suggestionsVisible && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
				aria-autocomplete='list'
				aria-controls={suggestionsVisible ? listId : undefined}
				aria-expanded={suggestionsVisible}
				aria-label={placeholder}
				autoComplete='off'
				disabled={!foregroundSession}
				placeholder={placeholder}
				role='combobox'
				value={query}
				onBlur={() => { setFocused(false); setActiveIndex(-1); }}
				onChange={event => { setQuery(event.target.value); setActiveIndex(-1); setFocused(true); }}
				onFocus={() => setFocused(true)}
				onKeyDown={onKeyDown}
			/>
			{/* Always rendered, so screen readers announce the status when it changes. */}
			<span className='help-search-status' role='status'>
				{searching ? localize('positronHelpSearch.searching', "Searching...") : ''}
			</span>
			{/* Clearing removes this button, so focus returns to the input. */}
			{query && <button aria-label={clearHelpSearch} type='button' onClick={() => { cancelSearch(); setQuery(''); setActiveIndex(-1); setFocused(false); inputRef.current?.focus(); }}>
				<span className={ThemeIcon.asClassName(ThemeIcon.fromId('close'))} />
			</button>}
			{suggestionsVisible && <div ref={suggestionsRef} aria-label={helpTopics} className='help-search-suggestions' id={listId} role='listbox'>
				{topics.map((suggestion, index) => <button
					key={JSON.stringify([suggestion.package, suggestion.topic])}
					aria-selected={index === activeIndex}
					className={index === activeIndex ? 'active' : undefined}
					id={`${listId}-${index}`}
					role='option'
					tabIndex={-1}
					type='button'
					onClick={() => { hoverManager?.hideHover(); void runSearch(suggestion); }}
					onMouseDown={event => event.preventDefault()}
					onMouseEnter={event => {
						// Show the full name when the label, the first child, is cut off.
						const label = event.currentTarget.firstElementChild;
						if (label && label.scrollWidth > label.clientWidth) {
							hoverManager?.showHover(event.currentTarget, [suggestion.label, suggestion.detail].filter(Boolean).join(' '));
						}
					}}
					onMouseLeave={() => hoverManager?.hideHover()}
				>
					<span className='label'>{suggestion.label}</span>
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
