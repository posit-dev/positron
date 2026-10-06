/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './actionBars.css';

// React.
import { isCancellationError } from '../../../../../base/common/errors.js';
import { RuntimeState } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { FormEvent, KeyboardEvent, PropsWithChildren, useEffect, useRef, useState } from 'react';

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

const kMaximumSuggestions = 50;

const HelpSearch = () => {
	const services = usePositronReactServicesContext();
	const inFlight = useRef<{ sessionId: string; promise: Promise<HelpTopicSuggestion[]> } | undefined>(undefined);
	const [foregroundSession, setForegroundSession] = useState(services.runtimeSessionService.foregroundSession);
	const [query, setQuery] = useState('');
	const [topics, setTopics] = useState<HelpTopicSuggestion[]>([]);
	const [focused, setFocused] = useState(false);
	const [activeIndex, setActiveIndex] = useState(-1);
	const [submitting, setSubmitting] = useState(false);
	const submission = useRef(0);
	const [runtimeState, setRuntimeState] = useState(foregroundSession?.getRuntimeState());

	useEffect(() => {
		const disposable = services.runtimeSessionService.onDidChangeForegroundSession(session => {
			setForegroundSession(session);
			setRuntimeState(session?.getRuntimeState());
			submission.current++;
			setSubmitting(false);
			setTopics([]);
			setActiveIndex(-1);
		});
		return () => disposable.dispose();
	}, [services.runtimeSessionService]);


	useEffect(() => {
		const listener = foregroundSession?.onDidChangeRuntimeState(setRuntimeState);
		return () => listener?.dispose();
	}, [foregroundSession]);

	useEffect(() => {
		setTopics([]);
		setActiveIndex(-1);
		if (!focused || !foregroundSession || !query.trim()) {
			return;
		}
		let cancelled = false;
		let dispatched = false;
		let timer: number | undefined;
		const ready = () => [RuntimeState.Idle, RuntimeState.Ready].includes(foregroundSession.getRuntimeState());
		const requestSuggestions = async () => {
			if (cancelled || dispatched || !ready()) {
				return;
			}
			if (inFlight.current?.sessionId === foregroundSession.sessionId) {
				await inFlight.current.promise.catch(() => []);
			}
			if (cancelled || dispatched || !ready()) {
				return;
			}
			dispatched = true;
			const promise = services.positronHelpService.getHelpTopics(query.trim(), kMaximumSuggestions);
			const request = { sessionId: foregroundSession.sessionId, promise };
			inFlight.current = request;
			try {
				const result = await promise;
				if (!cancelled) {
					setTopics(result);
				}
			} catch {
				// Full search remains available when suggestions fail.
			} finally {
				if (inFlight.current === request) {
					inFlight.current = undefined;
				}
			}
		};
		const schedule = () => {
			if (!dispatched) {
				window.clearTimeout(timer);
				timer = window.setTimeout(() => void requestSuggestions(), 200);
			}
		};
		// Wait for idle if user code is running. Once dispatched, the comm's
		// own Busy/Idle events must not trigger another identical request.
		const listener = foregroundSession.onDidChangeRuntimeState(schedule);
		schedule();
		return () => {
			cancelled = true;
			window.clearTimeout(timer);
			listener.dispose();
		};
	}, [focused, foregroundSession, query, services.positronHelpService]);

	const suggestions = topics;

	const runSearch = async (topic?: HelpTopicSuggestion) => {
		const value = query.trim();
		if ((!value && !topic) || submitting) {
			return;
		}
		const currentSubmission = ++submission.current;
		setSubmitting(true);
		setActiveIndex(-1);
		setFocused(false);
		try {
			const result = topic
				? await services.positronHelpService.showHelpTopicForForegroundSession(topic.topic)
				: await services.positronHelpService.searchHelp(value);
			if (submission.current === currentSubmission) {
				if (topic && result === HelpTopicResult.NotFound) {
					services.notificationService.info(localize('positronHelpSearch.notFound', "No help found for '{0}'.", topic.topic));
				} else if (result === HelpTopicResult.Unavailable || result === false) {
					services.notificationService.info(localize('positronHelpSearch.unavailable', "Help search is unavailable for the active interpreter."));
				}
			}
		} catch (error) {
			if (isCancellationError(error) || submission.current !== currentSubmission) {
				return;
			}
			services.notificationService.warn(localize('positronHelpSearch.error', "An error occurred while searching help: {0}", error.message));
		} finally {
			if (submission.current === currentSubmission) {
				setSubmitting(false);
			}
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
			{submitting && <span role='status'>
				{runtimeState === RuntimeState.Busy || runtimeState === RuntimeState.Interrupting
					? localize('positronHelpSearch.waiting', "Waiting for interpreter…")
					: localize('positronHelpSearch.searching', "Searching…")}
			</span>}
			{query && <button aria-label={clearHelpSearch} disabled={submitting} type='button' onClick={() => setQuery('')}>
				<span className={ThemeIcon.asClassName(ThemeIcon.fromId('close'))} />
			</button>}
			{focused && suggestions.length > 0 && <div className='help-search-suggestions' id={listId} role='listbox'>
				{suggestions.map((suggestion, index) => <button
					key={suggestion.topic}
					aria-selected={index === activeIndex}
					className={index === activeIndex ? 'active' : undefined}
					id={`${listId}-${index}`}
					role='option'
					type='button'
					onClick={() => void runSearch(suggestion)}
					onMouseDown={event => event.preventDefault()}
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
