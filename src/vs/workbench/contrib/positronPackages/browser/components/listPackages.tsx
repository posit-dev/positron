/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './listPackages.css';

// React.
import React, {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';

// Other dependencies.
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';
import { ActionBarFilter, ActionBarFilterHandle } from '../../../../../platform/positronActionBar/browser/components/actionBarFilter.js';
import { ViewsProps } from '../positronPackages.js';
import { Separator } from '../../../../../base/common/actions.js';
import { localize } from '../../../../../nls.js';
import { URI } from '../../../../../base/common/uri.js';
import { matchesSomeScheme, Schemas } from '../../../../../base/common/network.js';
import { usePositronPackagesContext } from '../positronPackagesContext.js';
import { ILanguageRuntimePackage } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { ProgressBar } from '../../../../../base/browser/ui/progressbar/progressbar.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { showCustomContextMenu, CustomContextMenuSubmenu, CustomContextMenuEntry } from '../../../../browser/positronComponents/customContextMenu/customContextMenu.js';
import { CustomContextMenuItem } from '../../../../browser/positronComponents/customContextMenu/customContextMenuItem.js';
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';
import { addFilterToQuery, applySortToQuery, clearFiltersFromQuery, PackagesFilter, PackagesSortOrder, parseQuery, removeFilterFromQuery } from './packagesQuery.js';
import { PositronList } from '../../../../browser/positronList/positronList.js';
import { ListEntry, PositronListInstance, PositronListItemContext } from '../../../../browser/positronList/classes/positronListInstance.js';
import { POSITRON_PACKAGES_IS_BUSY } from '../positronPackagesContextKeys.js';
import { useContextKey } from '../../../../../base/browser/positronReactHooks.js';
import { showPackageHelp } from '../packageHelp.js';

const positronUninstallPackage = localize(
	'positronUninstallPackage',
	'Uninstall Package',
);

const positronUpdatePackage = localize(
	'positronUpdatePackage',
	'Update Package',
);

// Row heights for each item size mode.
const ROW_ITEM_HEIGHT = 26;
const CARD_ITEM_HEIGHT = 72;

export const ListPackages = (props: React.PropsWithChildren<ViewsProps>) => {
	const {
		activeInstance,
	} = usePositronPackagesContext();
	const services = usePositronReactServicesContext();

	const [packages, setPackages] = useState<ILanguageRuntimePackage[]>([]);

	// Packages to flash after an install/update completes. The nonce lets the
	// apply effect run once per operation even though the same names may arrive
	// while filteredPackages is still settling.
	const [highlight, setHighlight] = useState<{ names: string[]; nonce: number }>();

	// IDs of packages currently showing the transient "recently changed" flash.
	const [flashedIds, setFlashedIds] = useState<ReadonlySet<string>>(new Set());

	// Item size mode ('card' or 'row'), driven by the packages service.
	const [itemSize, setItemSize] = useState(() => services.positronPackagesService.itemSize);
	useEffect(() => {
		const disposable = services.positronPackagesService.onDidChangeItemSize((size) => {
			setItemSize(size);
		});
		return () => disposable.dispose();
	}, [services.positronPackagesService]);

	// Tracks the last package name opened as a detail editor. Used to avoid
	// reopening the editor when a list refresh re-selects the same package.
	const lastOpenedRef = useRef<string | undefined>(undefined);

	// Progress Bar
	const progressRef = useRef<HTMLDivElement>(null);

	const loading = useContextKey(POSITRON_PACKAGES_IS_BUSY);

	useEffect(() => {
		if (!activeInstance) {
			setPackages([]);
			return;
		}

		const refreshDisposable = activeInstance.onDidRefreshPackagesInstance((packages) => {
			setPackages(packages);
		});

		// An install/update finished; record the affected packages so the apply
		// effect below can scroll to and flash them once the list has refreshed.
		const changeDisposable = activeInstance.onDidChangePackages((names) => {
			setHighlight({ names, nonce: Date.now() });
		});

		setPackages(activeInstance.packages);

		return () => {
			refreshDisposable.dispose();
			changeDisposable.dispose();
		};
	}, [activeInstance]);

	useEffect(() => {
		let progressBar: ProgressBar | undefined;
		let debounceTimeout: Timeout | undefined;

		const clearProgressBar = () => {
			if (debounceTimeout) {
				clearTimeout(debounceTimeout);
				debounceTimeout = undefined;
			}

			if (progressBar) {
				progressBar.done();
				progressBar.dispose();
				progressBar = undefined;
				progressRef.current?.replaceChildren();
			}
		};

		// timeout is the delay in milliseconds before showing the progress bar
		const setProgressBar = (timeout: number) => {
			// If there's a progress bar already scheduled to appear we'll clean it up,
			// and schedule a new one.
			if (debounceTimeout) {
				clearTimeout(debounceTimeout);
				debounceTimeout = undefined;
			}

			debounceTimeout = setTimeout(() => {
				// No work to do if we don't have a progress bar.
				if (!progressRef.current) {
					return;
				}
				// Before starting a new render, remove any existing progress bars. This prevents
				// a buildup of progress bars when rendering multiple times and ensures the progress bar
				// is removed when a new render is requested before the previous one completes.
				progressRef.current.replaceChildren();
				// Create the progress bar.
				progressBar = new ProgressBar(progressRef.current);
				progressBar.infinite();
			}, timeout);
		};

		if (loading) {
			setProgressBar(100);
		}

		return () => {
			clearProgressBar();
		};
	}, [loading]);

	// The filter input is the single source of truth. `queryText` is the raw
	// input; structured state (sort, free-text filter) is derived from it.
	const [queryText, setQueryText] = useState('');
	const [debouncedQueryText, setDebouncedQueryText] = useState('');
	const filterRef = useRef<ActionBarFilterHandle>(null);

	// Current sort and filter derived from the immediate (non-debounced) query
	// so the menu's checked state updates without waiting for the debounce.
	const currentQuery = useMemo(() => parseQuery(queryText), [queryText]);
	const currentSort = currentQuery.sort;
	const currentFilters = currentQuery.filters;

	// PositronListInstance. Recreated when itemSize changes so each mode gets its own row
	// height; the renderer is set later via setItemRenderer so it can close over the latest
	// packages/services state without forcing another recreation.
	const listInstance = useMemo(() => new PositronListInstance<ILanguageRuntimePackage>({
		itemHeight: itemSize === 'card' ? CARD_ITEM_HEIGHT : ROW_ITEM_HEIGHT,
		itemRenderer: () => null,
	}), [itemSize]);

	// Clear selection when filter text changes.
	const handleFilterTextChanged = (text: string) => {
		setQueryText(text);
		listInstance.clearSelection();
	};

	// Debounce filter text changes (300ms).
	useEffect(() => {
		const timeout = setTimeout(() => {
			setDebouncedQueryText(queryText);
		}, 300);
		return () => clearTimeout(timeout);
	}, [queryText]);

	// Deduplicate packages by name, keeping only the first occurrence.
	// The same package can exist in multiple library paths (e.g., user and system libraries).
	// We show only the first one, matching R's library search order.
	const deduplicatedPackages = useMemo(() => {
		const seen = new Set<string>();
		return packages.filter((pkg) => {
			if (seen.has(pkg.name)) {
				return false;
			}
			seen.add(pkg.name);
			return true;
		});
	}, [packages]);

	// Parse the debounced query so filtering and sorting run off the same snapshot.
	const debouncedQuery = useMemo(() => parseQuery(debouncedQueryText), [debouncedQueryText]);

	// Filter packages based on the debounced free-text (case-insensitive, matches name or displayName)
	// and sort according to the current sort order.
	const filteredPackages = useMemo(() => {
		let result = deduplicatedPackages;

		// Active filters intersect: each one narrows the result independently.
		if (debouncedQuery.filters.includes(PackagesFilter.Outdated)) {
			result = result.filter((pkg) => pkg.outdated === true);
		}
		if (debouncedQuery.filters.includes(PackagesFilter.Attached)) {
			result = result.filter((pkg) => pkg.attached === true);
		}

		if (debouncedQuery.text) {
			const lowerFilter = debouncedQuery.text.toLowerCase();
			result = result.filter((pkg) =>
				pkg.name.toLowerCase().includes(lowerFilter) ||
				pkg.displayName.toLowerCase().includes(lowerFilter)
			);
		}

		result = [...result].sort((a, b) => {
			const comparison = a.name.localeCompare(b.name);
			return debouncedQuery.sort === PackagesSortOrder.NameAsc ? comparison : -comparison;
		});

		return result;
	}, [deduplicatedPackages, debouncedQuery]);

	// Push the latest filtered packages into the list. Wrapping in {kind: 'item'} is the
	// PositronList entry contract; this list has no sections.
	useEffect(() => {
		// Selection is tracked by row index in the data grid; entries may reorder on refresh,
		// so re-anchor by package id after pushing the new entries.
		const previouslySelectedId = listInstance.getSelectedItems()[0]?.id;

		const entries: ListEntry<ILanguageRuntimePackage, never>[] = filteredPackages.map(pkg => ({
			kind: 'item',
			item: pkg,
		}));
		listInstance.setEntries(entries);

		if (previouslySelectedId !== undefined) {
			const newIndex = filteredPackages.findIndex(p => p.id === previouslySelectedId);
			if (newIndex >= 0) {
				listInstance.selectRow(newIndex);
			} else {
				listInstance.clearSelection();
			}
		}
	}, [listInstance, filteredPackages]);

	// After an install/update, scroll to and flash the affected packages once
	// the refreshed list reflects them. Keyed on the highlight nonce (consumed
	// via a ref) so the asynchronous Stage 2 metadata refresh, which fires
	// another package update, does not re-trigger the flash. Packages filtered
	// out by an active search are skipped rather than revealed.
	const handledHighlightNonce = useRef<number | undefined>(undefined);
	useEffect(() => {
		if (!highlight || highlight.nonce === handledHighlightNonce.current) {
			return;
		}
		handledHighlightNonce.current = highlight.nonce;

		const indices = highlight.names
			.map(name => filteredPackages.findIndex(pkg => pkg.name === name))
			.filter(index => index >= 0);
		if (indices.length === 0) {
			return;
		}

		const firstIndex = Math.min(...indices);
		void listInstance.scrollToRow(firstIndex);
		// A single affected package (install, single update) also becomes the
		// selection; a bulk update has no meaningful single row to select.
		if (highlight.names.length === 1) {
			listInstance.selectRow(firstIndex);
		}

		setFlashedIds(new Set(indices.map(index => filteredPackages[index].id)));
	}, [highlight, filteredPackages, listInstance]);

	// Clear the flash after it has had time to play. Kept separate from the
	// apply effect so the asynchronous Stage 2 refresh (which re-runs the apply
	// effect via filteredPackages) cannot cancel the timer mid-flash.
	useEffect(() => {
		if (flashedIds.size === 0) {
			return;
		}
		const timeout = setTimeout(() => setFlashedIds(new Set()), 2000);
		return () => clearTimeout(timeout);
	}, [flashedIds]);

	// Show the help page for a package using the active session's language. Falls back to a
	// notification if the help service can't find anything.
	const showHelpForPackage = useCallback(async (packageName: string) => {
		const session = activeInstance?.session;
		if (!session) {
			return;
		}
		await showPackageHelp(session, services.positronHelpService, services.notificationService, packageName);
	}, [activeInstance, services]);

	// Replace the item renderer whenever its closed-over deps change so the latest
	// deduplicatedPackages snapshot is visible to "Copy All" and clicks select via the
	// instance.
	useEffect(() => {
		const renderItem = (pkg: ILanguageRuntimePackage, ctx: PositronListItemContext) => {
			const { name, displayName, version, latestVersion, attached, outdated, description, url } = pkg;
			// Validate the kernel-provided URL in core: only surface http(s) links
			// so a malformed or non-web scheme (file:, javascript:, ...) coming from
			// the runtime can never reach the opener.
			const hasValidUrl = !!url && matchesSomeScheme(url, Schemas.http, Schemas.https);
			// Display the update indicator only when the runtime has confirmed the
			// package is outdated *and* we know which version to advertise. The
			// resolver-supplied `latestVersion` (or P3M as fallback) feeds the
			// tooltip; without it we'd render "Update available: undefined".
			const hasUpdate = outdated === true && !!latestVersion;

			const showRowContextMenu = (anchor: { x: number; y: number }) => {
				services.contextMenuService.showContextMenu({
					getActions: () => [
						{
							id: 'showHelp',
							label: localize('positronPackages.showHelp', "Show Help"),
							tooltip: localize('positronPackages.showHelp', "Show Help"),
							class: undefined,
							enabled: true,
							run: () => { void showHelpForPackage(name); }
						},
						new Separator(),
						{
							id: 'copy',
							label: localize('positronPackages.copyPackage', "Copy '{0} ({1})'", name, version),
							tooltip: localize('positronPackages.copyPackage', "Copy '{0} ({1})'", name, version),
							class: undefined,
							enabled: true,
							run: () => services.clipboardService.writeText(`${name} (${version})`)
						},
						{
							id: 'copyAll',
							label: localize('positronPackages.copyAllPackages', 'Copy All'),
							tooltip: localize('positronPackages.copyAllPackages', 'Copy All'),
							class: undefined,
							enabled: true,
							run: () => services.clipboardService.writeText(deduplicatedPackages.map((pkg) => `${pkg.name} (${pkg.version})`).join('\n'))
						},
						new Separator(),
						{
							id: 'updatePackage',
							label: positronUpdatePackage,
							tooltip: positronUpdatePackage,
							class: undefined,
							enabled: true,
							run: () => services.commandService.executeCommand('positronPackages.updatePackage', name)

						},
						{
							id: 'uninstallPackage',
							label: positronUninstallPackage,
							tooltip: positronUninstallPackage,
							class: undefined,
							enabled: true,
							run: () => services.commandService.executeCommand('positronPackages.uninstallPackage', name)
						}
					],
					getAnchor: () => anchor
				});
			};

			const helpButton = (
				<Button
					ariaLabel={localize('positronPackages.showHelpAriaLabel', "Show help for {0}", name)}
					className='packages-list-item-action-button packages-list-item-help'
					tooltip={localize('positronPackages.showHelpTooltip', "Show help for {0}", name)}
					onPressed={() => { void showHelpForPackage(name); }}
				>
					<span className='codicon codicon-book' />
				</Button>
			);

			const urlButton = hasValidUrl ? (
				<Button
					ariaLabel={localize('positronPackages.openUrlAriaLabel', "Open website for {0}", name)}
					className='packages-list-item-action-button packages-list-item-url'
					tooltip={localize('positronPackages.openUrlTooltip', "Open website for {0}", name)}
					onPressed={() => { void services.openerService.open(URI.parse(url!), { openExternal: true }); }}
				>
					<span className='codicon codicon-link-external' />
				</Button>
			) : null;

			const rowActions = (
				<>
					{urlButton}
					{helpButton}
				</>
			);

			return (
				// eslint-disable-next-line jsx-a11y/no-static-element-interactions
				<div
					className={positronClassNames('packages-list-item', `item-size-${itemSize}`, { 'recently-changed': flashedIds.has(pkg.id) })}
					onContextMenu={(e) => {
						// Right-click. The data grid's row cell calls e.stopPropagation() on
						// mousedown, so right-click handling lives on contextmenu instead.
						e.preventDefault();
						e.stopPropagation();
						showRowContextMenu({ x: e.clientX, y: e.clientY });
					}}
					onDoubleClick={() => {
						// Double-click pins the editor (matching the Extensions pane behaviour).
						lastOpenedRef.current = pkg.name;
						void services.commandService.executeCommand('positronPackages.openPackage', pkg.name, true);
					}}
				>
					{attached !== undefined && (
						<span
							aria-label={attached
								? localize('positronPackages.attachedAriaLabel', "{0} is attached", name)
								: localize('positronPackages.notAttachedAriaLabel', "{0} is not attached", name)}
							className={positronClassNames('packages-list-item-attached', { attached })}
							role='img'
							title={attached
								? localize('positronPackages.attachedTooltip', "{0} is attached", name)
								: localize('positronPackages.notAttachedTooltip', "{0} is not attached", name)}
						/>
					)}
					<div className='packages-list-item-content'>
						<div className='packages-list-item-header'>
							<div className='packages-list-item-name'>{displayName}</div>
							<div className='packages-list-item-version'>{version}</div>
							{itemSize === 'row' && hasUpdate && (
								<div
									className='packages-list-item-update'
									title={localize('positronPackages.updateAvailable', "Update available: {0}", latestVersion)}
								>
									&#x2191;
								</div>
							)}
							{itemSize === 'card' && rowActions}
						</div>
						{itemSize === 'card' && (
							<div className='packages-list-item-description-row'>
								<div className='packages-list-item-description' title={description ?? ''}>
									{description ?? ''}
								</div>
								{hasUpdate && (
									<Button
										ariaLabel={localize('positronPackages.updatePackageAria', "Update {0} to {1}", name, latestVersion)}
										className='packages-list-item-update-button'
										tooltip={localize('positronPackages.updateAvailable', "Update available: {0}", latestVersion)}
										onPressed={() => services.commandService.executeCommand('positronPackages.updatePackage', name)}
									>
										{localize('positronPackages.update', "Update")}
									</Button>
								)}
							</div>
						)}
					</div>
					{itemSize === 'row' && rowActions}
				</div>
			);
		};

		listInstance.setItemRenderer(renderItem);
	}, [listInstance, deduplicatedPackages, services, itemSize, showHelpForPackage, flashedIds]);

	// Sync the currently-selected package's name into the packages service. onDidUpdate fires
	// for any instance change (selection, cursor, scroll), so we dedupe before pushing.
	// When the selection changes to a new non-empty package, also open a preview editor.
	useEffect(() => {
		const pushSelection = () => {
			const name = listInstance.getSelectedItems()[0]?.name;
			services.positronPackagesService.setSelectedPackage(name);
		};
		// Push once on mount in case selection already exists.
		pushSelection();
		let lastName: string | undefined;
		const disposable = listInstance.onDidUpdate(() => {
			const name = listInstance.getSelectedItems()[0]?.name;
			if (name !== lastName) {
				lastName = name;
				services.positronPackagesService.setSelectedPackage(name);
				// Open a preview (non-pinned) editor when the selected package changes.
				// lastOpenedRef guards against reopening on list refreshes that
				// re-select the same row without the user having changed selection.
				if (name && name !== lastOpenedRef.current) {
					lastOpenedRef.current = name;
					void services.commandService.executeCommand('positronPackages.openPackage', name, false);
				}
			}
		});
		return () => {
			disposable.dispose();
			services.positronPackagesService.setSelectedPackage(undefined);
		};
	}, [listInstance, services]);

	// Dispose the list instance on unmount.
	useEffect(() => () => listInstance.dispose(), [listInstance]);

	// Rewrite the filter input to reflect the selected sort. The input is the
	// source of truth, so updating it flows back through onFilterTextChanged
	// and re-derives every dependent state. A trailing space is appended so
	// the user can immediately type free-text without first pressing space;
	// focus returns to the input for the same reason.
	const selectSort = (sort: PackagesSortOrder) => {
		const newText = applySortToQuery(queryText, sort);
		filterRef.current?.setFilterText(newText === '' ? '' : `${newText} `);
		filterRef.current?.focus();
	};

	// Add or remove a category filter from the input. The menu surfaces each
	// filter as an independent checkbox, so we add when it's off and remove
	// when it's on; an empty active set means "all packages".
	const toggleFilter = (filter: PackagesFilter) => {
		const newText = currentFilters.includes(filter)
			? removeFilterFromQuery(queryText, filter)
			: addFilterToQuery(queryText, filter);
		filterRef.current?.setFilterText(newText === '' ? '' : `${newText} `);
		filterRef.current?.focus();
	};

	// Clear all category filters. Free text and sort are preserved.
	const clearAllFilters = useCallback(() => {
		const newText = clearFiltersFromQuery(queryText);
		filterRef.current?.setFilterText(newText === '' ? '' : `${newText} `);
		filterRef.current?.focus();
	}, [queryText]);

	// Build the Filter submenu entries. Evaluated lazily so the checked state
	// reflects the current input when the submenu is opened. "All Packages"
	// reads as checked when no filters are active, otherwise clicking it
	// clears the active set.
	const filterSubmenuEntries = (): CustomContextMenuEntry[] => [
		new CustomContextMenuItem({
			label: localize('positronPackages.filterByAll', "All Packages"),
			checked: currentFilters.length === 0,
			onSelected: () => clearAllFilters(),
		}),
		new CustomContextMenuItem({
			label: localize('positronPackages.filterByOutdated', "Outdated"),
			checked: currentFilters.includes(PackagesFilter.Outdated),
			onSelected: () => toggleFilter(PackagesFilter.Outdated),
		}),
		new CustomContextMenuItem({
			label: localize('positronPackages.filterByAttached', "Attached"),
			checked: currentFilters.includes(PackagesFilter.Attached),
			onSelected: () => toggleFilter(PackagesFilter.Attached),
		}),
	];

	// Build the Sort submenu entries. Evaluated lazily so the checked state
	// reflects the current input when the submenu is opened.
	const sortSubmenuEntries = (): CustomContextMenuEntry[] => [
		new CustomContextMenuItem({
			label: localize('positronPackages.sortByNameAsc', "Name (A-Z)"),
			checked: currentSort === PackagesSortOrder.NameAsc,
			onSelected: () => selectSort(PackagesSortOrder.NameAsc),
		}),
		new CustomContextMenuItem({
			label: localize('positronPackages.sortByNameDesc', "Name (Z-A)"),
			checked: currentSort === PackagesSortOrder.NameDesc,
			onSelected: () => selectSort(PackagesSortOrder.NameDesc),
		}),
	];

	// Open the filter options menu anchored on the filter button.
	const showFilterMenu = (anchorElement: HTMLElement) => {
		showCustomContextMenu({
			anchorElement,
			popupPosition: 'auto',
			popupAlignment: 'auto',
			minWidth: 160,
			entries: [
				new CustomContextMenuSubmenu({
					icon: 'list-filter',
					label: localize('positronPackages.filterLabel', "Filter"),
					entries: filterSubmenuEntries,
				}),
				new CustomContextMenuSubmenu({
					icon: 'arrow-swap-vertical',
					label: localize('positronPackages.sortLabel', "Sort"),
					entries: sortSubmenuEntries,
				}),
			],
		});
	};

	// Only show the "No packages found" message when the user has narrowed the
	// list (free text or active category filters). An unfiltered empty list
	// renders the (empty) data grid, matching prior behavior.
	const emptyListRenderer = (debouncedQuery.filters.length > 0 || debouncedQuery.text)
		? () => localize('positronPackages.noPackagesFound', "No packages found.")
		: undefined;

	return (
		<div className='positron-packages-list'>
			<div ref={progressRef} id='packages-progress' />

			<div className='packages-filter-container'>
				<ActionBarFilter
					ref={filterRef}
					showClearAlways
					filterButtonTooltip={localize('positronPackages.filterOptions', "Filter options")}
					placeholder={localize('positronPackages.filterPlaceholder', "Filter packages")}
					size='md'
					onFilterButtonPressed={showFilterMenu}
					onFilterTextChanged={handleFilterTextChanged}
				/>
			</div>
			<div className='packages-list-container'>
				<PositronList
					emptyListRenderer={emptyListRenderer}
					instance={listInstance}
				/>
			</div>
		</div>
	);
};
