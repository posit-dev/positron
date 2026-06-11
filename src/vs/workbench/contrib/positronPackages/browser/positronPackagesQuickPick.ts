/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Delayer } from '../../../../base/common/async.js';
import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { isCancellationError } from '../../../../base/common/errors.js';
import { DisposableStore, IDisposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IInputBox, IQuickInput, IQuickInputButton, IQuickInputService, IQuickPickItem, QuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';
import * as semver from '../../../../base/common/semver/semver.js';

/**
 * Debounce interval (ms) before firing a package search as the user types. Long
 * enough to avoid a query per keystroke against the backend, short enough to
 * still feel live.
 */
const SEARCH_DEBOUNCE_MS = 300;

/**
 * Cap on the number of search results fed to the quick pick. A broad query
 * (e.g. "a") can match thousands of packages from some backends; rendering them
 * all is wasteful for results no one will scroll. Applied after the exact-match
 * hoist so a precise match always survives the cap. Backends may cap further
 * upstream (pak and PyPI both cap at 100); this is the uniform safety net.
 */
const MAX_SEARCH_RESULTS = 100;

/**
 * Move an exact, case-insensitive name match to the front of the results,
 * leaving the backend's relative ordering of everything else untouched. We
 * defer to the backend's own ranking (pak/PPM, PyPI) and only guarantee that a
 * precise name match surfaces first.
 */
export function hoistExactMatch(results: PackageSearchResult[], query: string): PackageSearchResult[] {
	const normalized = query.trim().toLowerCase();
	const index = results.findIndex((result) => result.name.toLowerCase() === normalized);
	if (index <= 0) {
		// Not found, or already first; nothing to reorder.
		return results;
	}
	return [results[index], ...results.slice(0, index), ...results.slice(index + 1)];
}

interface VersionSearchResult {
	name: string;
}

interface PackageSearchResult {
	name: string;
	// description appears inline with the name
	description?: string;
	// detail appears on the second line
	detail?: string;
}

/**
 * Sort version strings in descending order (newest first).
 * Uses semver comparison when possible, falls back to string comparison.
 */
function sortVersionsDescending(versions: string[]): string[] {
	return [...versions].sort((a, b) => {
		const aSemver = semver.valid(a, true) ? a : semver.coerce(a);
		const bSemver = semver.valid(b, true) ? b : semver.coerce(b);

		if (aSemver && bSemver) {
			return semver.rcompare(aSemver, bSemver, true);
		}

		// Fall back to simple string comparison
		return a < b ? 1 : a > b ? -1 : 0;
	});
}

export const updatePackage = async (
	accessor: ServicesAccessor,
	performGetPackages: (q: string) => Promise<PackageSearchResult[]>,
	performLookup: (q: string) => Promise<string[]>,
	performUpdate: (pkg: string, version: string) => Promise<void>,
	packageToInstall?: string,
	cts?: CancellationTokenSource,
) => {
	const title = localize('positronPackages.updatePackageTitle', 'Update Package');

	interface State {
		query: string;
		packages: PackageSearchResult[];
		versions: VersionSearchResult[];
		selectedPackage: string | undefined;
		selectedVersion: string | undefined;
	}

	async function collectInputs() {
		const state: State = {
			query: '',
			packages: [],
			versions: [],
			selectedPackage: undefined,
			selectedVersion: undefined,
		};

		if (packageToInstall) {
			state.selectedPackage = packageToInstall;
			await MultiStepInput.run(accessor, (input) => pickVersion(input, state), cts);
		} else {
			await MultiStepInput.run(accessor, (input) => pickPackage(input, state), cts);
		}

		return state as State;
	}

	async function pickPackage(input: MultiStepInput, state: State) {
		const selection = await input.showQuickPick({
			title,
			step: 1,
			totalSteps: 2,
			placeholder: localize('positronPackages.updatePackagePlaceholder', 'Pick a package to update...'),
			items: [],
			// Show the picker immediately rather than blocking on the package
			// list before anything appears.
			loadItems: async () => {
				state.packages = await performGetPackages('');
				return state.packages.map((result) => ({ label: result.name }));
			},
		});

		state.selectedPackage = selection.label;

		return (input: MultiStepInput) => pickVersion(input, state);
	}

	async function pickVersion(input: MultiStepInput, state: State) {
		const selection = await input.showQuickPick({
			title,
			step: 2,
			totalSteps: 2,
			placeholder: localize('positronPackages.pickVersionPlaceholder', "Pick a version of {0} to update", state.selectedPackage),
			items: [],
			// Load versions after the picker is shown so a slow lookup doesn't
			// freeze the previous step on a disabled list.
			loadItems: async () => {
				const versions = await performLookup(state.selectedPackage ?? '');
				const sortedVersions = sortVersionsDescending(versions);
				state.versions = sortedVersions.map((v) => ({ name: v }));
				return state.versions.map((version) => ({ label: version.name }));
			},
		});

		state.selectedVersion = selection.label;
	}


	const state = await collectInputs();
	// If there is no selected package and version, it means the user canceled the QuickPick, so we should not perform the update.
	if (state.selectedPackage && state.selectedVersion) {
		await performUpdate(state.selectedPackage, state.selectedVersion);
	}
};

export const uninstallPackage = async (
	accessor: ServicesAccessor,
	performGetPackages: (q: string) => Promise<PackageSearchResult[]>,
	performUninstall: (pkg: string, version?: string) => Promise<void>,
	cts?: CancellationTokenSource,
) => {
	const title = localize('positronPackages.uninstallPackageTitle', 'Uninstall Package');

	interface State {
		packages: PackageSearchResult[];
		selectedPackage: string | undefined;
	}

	async function collectInputs() {
		const state = {
			packages: [],
			selectedPackage: undefined,
		};
		await MultiStepInput.run(accessor, (input) => pickPackage(input, state), cts);
		return state as State;
	}

	async function pickPackage(input: MultiStepInput, state: State) {
		const selection = await input.showQuickPick({
			title,
			step: 1,
			totalSteps: 1,
			placeholder: localize('positronPackages.uninstallPackagePlaceholder', 'Pick a package to uninstall...'),
			items: [],
			// Show the picker immediately rather than blocking on the package
			// list before anything appears.
			loadItems: async () => {
				state.packages = await performGetPackages('');
				return state.packages.map((result) => ({ label: result.name }));
			},
		});

		state.selectedPackage = selection.label;
	}

	const state = await collectInputs();
	if (state.selectedPackage) {
		await performUninstall(state.selectedPackage);
	}
};

export const installPackage = async (
	accessor: ServicesAccessor,
	performSearch: (q: string, token: CancellationToken) => Promise<PackageSearchResult[]>,
	performLookup: (q: string) => Promise<string[]>,
	performInstall: (pkg: string, version?: string) => Promise<void>,
	cts?: CancellationTokenSource,
) => {
	const title = localize('positronPackages.installPackageTitle', 'Install Package');

	interface State {
		query: string;
		packages: PackageSearchResult[];
		versions: VersionSearchResult[];
		selectedPackage: string | undefined;
		selectedVersion: string | undefined;
	}

	async function collectInputs() {
		const state = {
			query: '',
			packages: [],
			versions: [],
			selectedPackage: undefined,
			selectedVersion: undefined,
		};
		await MultiStepInput.run(accessor, (input) => searchPackage(input, state), cts);
		return state as State;
	}

	async function pickVersion(input: MultiStepInput, state: State) {
		const selection = await input.showQuickPick({
			title,
			step: 2,
			totalSteps: 2,
			placeholder: localize('positronPackages.installPackageVersionPlaceholder', "Pick a version of '{0}' to install", state.selectedPackage),
			items: [],
			// Load versions after the picker is shown so a slow lookup (e.g.
			// conda) doesn't freeze the previous step on a disabled list.
			loadItems: async () => {
				const versions = await performLookup(state.selectedPackage ?? '');
				const sortedVersions = sortVersionsDescending(versions);
				state.versions = sortedVersions.map((v) => ({ name: v }));
				return state.versions.map((version) => ({ label: version.name }));
			},
		});

		state.selectedVersion = selection.label;
	}

	async function searchPackage(input: MultiStepInput, state: State) {
		const selection = await input.showSearchableQuickPick({
			title,
			step: 1,
			totalSteps: 2,
			value: state.query,
			placeholder: localize('positronPackages.installPackagePlaceholder', 'Search for a package to install...'),
			search: async (query: string, token: CancellationToken) => {
				// Remember the query so it's restored when navigating back here.
				state.query = query;
				const results = await performSearch(query, token);
				state.packages = results;
				// Defer to the backend's ordering, but surface an exact name
				// match first (see hoistExactMatch), then cap so a broad query
				// doesn't flood the quick pick. Hoist before the cap so the
				// exact match always survives it.
				return hoistExactMatch(results, query)
					.slice(0, MAX_SEARCH_RESULTS)
					.map((result) => ({ label: result.name }));
			},
			noResultsItem: (query: string) => ({
				label: localize('positronPackages.noPackagesFound', "No packages found for '{0}'", query),
			}),
			errorItem: () => ({
				label: localize('positronPackages.errorSearchingPackages', 'Error searching packages.'),
			}),
		});

		state.selectedPackage = selection.label;

		return (input: MultiStepInput) => pickVersion(input, state);
	}

	const state = await collectInputs();
	// If there is no selected package and version, it means the user canceled the QuickPick, so we should not perform the install.
	if (state.selectedPackage && state.selectedVersion) {
		await performInstall(state.selectedPackage, state.selectedVersion);
	}
};

// -------------------------------------------------------
// Helper code that wraps the API for the multi-step case.
// -------------------------------------------------------

class InputFlowAction {
	static back = new InputFlowAction();
	static cancel = new InputFlowAction();
	static resume = new InputFlowAction();
}

type InputStep = (input: MultiStepInput) => Thenable<InputStep | void>;

interface QuickPickParameters<T extends QuickPickItem> {
	title: string;
	step: number;
	totalSteps: number;
	items: T[];
	activeItem?: T;
	ignoreFocusOut?: boolean;
	placeholder: string;
	buttons?: IQuickInputButton[];
	/**
	 * When provided, the quick pick is shown immediately in a busy state and its
	 * items are populated from this loader when it resolves, instead of blocking
	 * on a slow fetch before the picker appears. Keeps the step responsive (Back
	 * and Escape work while loading) rather than freezing the previous step. The
	 * token is cancelled if the picker is dismissed before the load completes.
	 */
	loadItems?: (token: CancellationToken) => Promise<T[]>;
}

interface SearchableQuickPickParameters<T extends QuickPickItem> {
	title: string;
	step: number;
	totalSteps: number;
	placeholder: string;
	value?: string;
	/**
	 * Runs on each (debounced) change to the input value, with a token that is
	 * cancelled when a newer search supersedes this one or the picker is hidden.
	 * Returns the items to display, already ordered as they should appear.
	 */
	search: (query: string, token: CancellationToken) => Promise<T[]>;
	/**
	 * Builds the single, non-selectable item shown when {@link search} returns
	 * no results, so the picker isn't a confusing blank. The returned item
	 * cannot be picked (selecting it is a no-op). Omit to leave the list empty.
	 */
	noResultsItem?: (query: string) => T;
	/**
	 * Builds the single, non-selectable item shown when {@link search} throws
	 * (a non-cancellation error), so a failed search reads as an error rather
	 * than a blank or a false "no results". Cannot be picked. Omit to leave the
	 * list empty on error.
	 */
	errorItem?: (query: string) => T;
	buttons?: IQuickInputButton[];
	ignoreFocusOut?: boolean;
}

interface InputBoxParameters {
	title: string;
	step: number;
	totalSteps: number;
	value: string;
	prompt: string;
	validate?: (value: string) => Promise<string | undefined>;
	perform?: (value: string, input: IInputBox) => Promise<void>;
	buttons?: IQuickInputButton[];
	ignoreFocusOut?: boolean;
	placeholder?: string;
}

class MultiStepInput {
	quickPickService: IQuickInputService;
	static async run(accessor: ServicesAccessor, start: InputStep, cts?: CancellationTokenSource) {
		const quickPickService = accessor.get(IQuickInputService);
		const input = new MultiStepInput(quickPickService, cts);
		return input.stepThrough(start);
	}

	constructor(quickPickService: IQuickInputService, private readonly cts?: CancellationTokenSource) {
		this.quickPickService = quickPickService;
	}

	private current?: IQuickInput;
	private steps: InputStep[] = [];

	private async stepThrough(start: InputStep) {
		let step: InputStep | void = start;
		while (step) {
			this.steps.push(step);
			if (this.current) {
				this.current.enabled = false;
				this.current.busy = true;
			}
			try {
				step = await step(this);
			} catch (err) {
				if (err === InputFlowAction.back) {
					this.steps.pop();
					step = this.steps.pop();
				} else if (err === InputFlowAction.resume) {
					step = this.steps.pop();
				} else if (err === InputFlowAction.cancel || err.cause === InputFlowAction.cancel || err.message === InputFlowAction.cancel || err.message === 'canceled') {
					this.cts?.cancel();
					step = undefined;
				} else {
					throw err;
				}
			}
		}
		if (this.current) {
			this.current.dispose();
		}
	}

	async showQuickPick<T extends IQuickPickItem, P extends QuickPickParameters<T>>({
		title,
		step,
		totalSteps,
		items,
		activeItem,
		ignoreFocusOut,
		placeholder,
		buttons,
		loadItems,
	}: P) {
		const disposables: IDisposable[] = [];
		// Cancels an in-flight loadItems fetch if the picker is dismissed first.
		let loadCts: CancellationTokenSource | undefined;
		try {
			return await new Promise<T | (P extends { buttons: (infer I)[] } ? I : never)>(
				(resolve, reject) => {
					const input = this.quickPickService.createQuickPick<T>();
					input.title = title;
					input.step = step;
					input.totalSteps = totalSteps;
					input.ignoreFocusOut = ignoreFocusOut ?? false;
					input.placeholder = placeholder;
					input.items = items;
					if (activeItem) {
						input.activeItems = [activeItem];
					}
					input.buttons = [
						...(this.steps.length > 1 ? [this.quickPickService.backButton] : []),
						...(buttons || []),
					];
					disposables.push(
						input.onDidTriggerButton((item) => {
							if (item === this.quickPickService.backButton) {
								reject(InputFlowAction.back);
							} else {
								reject(item);
							}
						}),
						input.onDidChangeSelection((items) => resolve(items[0])),
						input.onDidHide(() => {
							this.cts?.cancel();
							reject(InputFlowAction.cancel);
						}),
					);
					if (this.current) {
						this.current.dispose();
					}
					this.current = input;
					this.current.show();
					if (loadItems) {
						// Show the picker now and fill it in when the (possibly
						// slow) fetch returns, rather than freezing the previous
						// step behind a disabled list.
						input.busy = true;
						loadCts = new CancellationTokenSource();
						const token = loadCts.token;
						loadItems(token).then(
							(loaded) => {
								if (token.isCancellationRequested) {
									return;
								}
								input.items = loaded;
								input.busy = false;
							},
							(error) => {
								if (token.isCancellationRequested || isCancellationError(error)) {
									return;
								}
								input.busy = false;
								reject(error);
							},
						);
					}
				},
			);
		} finally {
			loadCts?.cancel();
			loadCts?.dispose();
			disposables.forEach((d) => d.dispose());
		}
	}

	/**
	 * Like {@link showQuickPick}, but the item list is populated live from a
	 * search callback as the user types, rather than from a fixed list. The
	 * search is debounced, the previous in-flight query is cancelled when a new
	 * one starts, and the quick pick's own fuzzy filtering/sorting is disabled
	 * so results display in the order the callback returns them.
	 */
	async showSearchableQuickPick<T extends IQuickPickItem, P extends SearchableQuickPickParameters<T>>({
		title,
		step,
		totalSteps,
		placeholder,
		value,
		search,
		noResultsItem,
		errorItem,
		buttons,
		ignoreFocusOut,
	}: P) {
		const disposables = new DisposableStore();
		// Tracks the in-flight query so a superseding search (or hide) can
		// cancel it, both to abort the network request and to discard a stale
		// out-of-order response.
		let queryCts: CancellationTokenSource | undefined;
		// The current non-selectable status placeholder (no-results or error
		// message), held by identity so selecting it can be ignored.
		let messagePick: T | undefined;
		const cancelInFlight = () => {
			queryCts?.cancel();
			queryCts?.dispose();
			queryCts = undefined;
		};
		try {
			return await new Promise<T | (P extends { buttons: (infer I)[] } ? I : never)>(
				(resolve, reject) => {
					const input = this.quickPickService.createQuickPick<T>();
					input.title = title;
					input.step = step;
					input.totalSteps = totalSteps;
					input.ignoreFocusOut = ignoreFocusOut ?? false;
					input.placeholder = placeholder;
					input.value = value ?? '';
					// Preserve the order returned by the search callback: disable
					// the quick pick's built-in fuzzy match/sort so it neither
					// reorders nor hides backend-supplied results.
					input.matchOnLabel = false;
					input.matchOnDescription = false;
					input.matchOnDetail = false;
					input.sortByLabel = false;
					input.items = [];
					input.buttons = [
						...(this.steps.length > 1 ? [this.quickPickService.backButton] : []),
						...(buttons || []),
					];

					const runSearch = async (query: string) => {
						cancelInFlight();
						if (!query.trim()) {
							// Empty query: clear results, don't hit the backend.
							messagePick = undefined;
							input.items = [];
							input.busy = false;
							return;
						}
						queryCts = new CancellationTokenSource();
						const token = queryCts.token;
						input.busy = true;
						if (messagePick) {
							// A status message (no-results / error) describes the
							// previous query; drop it so it doesn't linger (and read
							// as a premature verdict) while the new query runs. Real
							// results are left in place to avoid flicker.
							messagePick = undefined;
							input.items = [];
						}
						try {
							const items = await search(query, token);
							if (token.isCancellationRequested) {
								return;
							}
							if (items.length === 0 && noResultsItem) {
								// Show a non-selectable placeholder so an empty
								// result reads as "nothing found" rather than a
								// blank, possibly-broken picker.
								messagePick = noResultsItem(query);
								input.items = [messagePick];
							} else {
								messagePick = undefined;
								input.items = items;
							}
						} catch (error) {
							if (token.isCancellationRequested || isCancellationError(error)) {
								return;
							}
							if (errorItem) {
								// Show a non-selectable error placeholder so a
								// failed search reads as "something went wrong"
								// rather than a blank (or false "nothing found").
								messagePick = errorItem(query);
								input.items = [messagePick];
							} else {
								// Surface nothing rather than stale results on error.
								messagePick = undefined;
								input.items = [];
							}
						} finally {
							if (!token.isCancellationRequested) {
								input.busy = false;
							}
						}
					};

					const delayer = disposables.add(new Delayer<void>(SEARCH_DEBOUNCE_MS));
					disposables.add(
						input.onDidChangeValue((text) => {
							// Abandon any in-flight query immediately, not just when
							// the next (debounced) search fires: otherwise a slow
							// query from a previous keystroke can resolve mid-typing
							// and paint stale results under the newer input. The new
							// query is still debounced below.
							cancelInFlight();
							delayer.trigger(() => runSearch(text));
						}),
					);
					disposables.add(
						input.onDidTriggerButton((item) => {
							if (item === this.quickPickService.backButton) {
								reject(InputFlowAction.back);
							} else {
								reject(item);
							}
						}),
					);
					disposables.add(
						input.onDidChangeSelection((items) => {
							// Ignore selection of the no-results placeholder.
							if (items[0] && items[0] !== messagePick) {
								resolve(items[0]);
							}
						}),
					);
					disposables.add(
						input.onDidHide(() => {
							this.cts?.cancel();
							reject(InputFlowAction.cancel);
						}),
					);
					if (this.current) {
						this.current.dispose();
					}
					this.current = input;
					this.current.show();
					// Restore results immediately when re-entering with a prior
					// query (e.g. after navigating back from the version step).
					if ((value ?? '').trim()) {
						delayer.trigger(() => runSearch(value!));
					}
				},
			);
		} finally {
			cancelInFlight();
			disposables.dispose();
		}
	}

	async showInputBox<P extends InputBoxParameters>({
		title,
		step,
		totalSteps,
		value,
		prompt,
		validate,
		perform,
		buttons,
		ignoreFocusOut,
		placeholder,
	}: P) {
		const disposables: IDisposable[] = [];
		try {
			return await new Promise<
				string | (P extends { buttons: (infer I)[] } ? I : never)
			>((resolve, reject) => {
				const input = this.quickPickService.createInputBox();
				input.title = title;
				input.step = step;
				input.totalSteps = totalSteps;
				input.value = value || '';
				input.prompt = prompt;
				input.ignoreFocusOut = ignoreFocusOut ?? false;
				input.placeholder = placeholder;
				input.buttons = [
					...(this.steps.length > 1 ? [this.quickPickService.backButton] : []),
					...(buttons || []),
				];
				let validating = validate?.('');
				disposables.push(
					input.onDidTriggerButton(async (item) => {
						if (item === this.quickPickService.backButton) {
							reject(InputFlowAction.back);
						} else {
							reject(item);
						}
					}),
					input.onDidAccept(async () => {
						const value = input.value;
						input.enabled = false;
						input.busy = true;
						try {
							if (!(await validate?.(value))) {
								await perform?.(value, input);
								resolve(value);
							}
						} finally {
							input.enabled = true;
							input.busy = false;
						}
					}),
					input.onDidChangeValue(async (text) => {
						const current = validate?.(text);
						validating = current;
						const validationMessage = await current;
						if (current === validating) {
							input.validationMessage = validationMessage;
						}
					}),
					input.onDidHide(async () => {
						reject(InputFlowAction.cancel);
					}),
				);
				if (this.current) {
					this.current.dispose();
				}
				this.current = input;
				this.current?.show();
			});
		} finally {
			disposables.forEach((d) => d.dispose());
		}
	}
}
