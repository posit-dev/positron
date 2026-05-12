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
import { isMacintosh } from '../../../../../base/common/platform.js';
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';
import { ActionBarFilter, ActionBarFilterHandle } from '../../../../../platform/positronActionBar/browser/components/actionBarFilter.js';
import { ViewsProps } from '../positronPackages.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { Separator } from '../../../../../base/common/actions.js';
import { localize } from '../../../../../nls.js';
import { usePositronPackagesContext } from '../positronPackagesContext.js';
import { ILanguageRuntimePackage } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { RuntimeCodeExecutionMode, RuntimeErrorBehavior } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { ProgressBar } from '../../../../../base/browser/ui/progressbar/progressbar.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { showCustomContextMenu, CustomContextMenuSubmenu, CustomContextMenuEntry } from '../../../../browser/positronComponents/customContextMenu/customContextMenu.js';
import { CustomContextMenuItem } from '../../../../browser/positronComponents/customContextMenu/customContextMenuItem.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';
import { applyFilterToQuery, applySortToQuery, PackagesFilter, PackagesSortOrder, parseQuery } from './packagesQuery.js';
import { PositronList } from '../../../../browser/positronList/positronList.js';
import { ListEntry, PositronListInstance, PositronListItemContext } from '../../../../browser/positronList/classes/positronListInstance.js';

const positronUninstallPackage = localize(
	'positronUninstallPackage',
	'Uninstall Package',
);

const positronUpdatePackage = localize(
	'positronUpdatePackage',
	'Update Package',
);

// Row height for package list items in pixels
const ITEM_HEIGHT = 26;

export const ListPackages = (props: React.PropsWithChildren<ViewsProps>) => {
	const {
		activeInstance,
	} = usePositronPackagesContext();
	const services = usePositronReactServicesContext();

	const [packages, setPackages] = useState<ILanguageRuntimePackage[]>([]);

	// Progress Bar
	const progressRef = useRef<HTMLDivElement>(null);

	const [refreshLoading, setRefreshLoading] = useState<boolean>(false);
	const [installLoading, setInstallLoading] = useState<boolean>(false);
	const [updateLoading, setUpdateLoading] = useState<boolean>(false);
	const [updateAllLoading, setUpdateAllLoading] = useState<boolean>(false);
	const [uninstallLoading, setUninstallLoading] = useState<boolean>(false);

	const loading = refreshLoading || installLoading || updateLoading || updateAllLoading || uninstallLoading;

	useEffect(() => {
		if (!activeInstance) {
			setPackages([]);
			return;
		}

		setPackages(activeInstance.packages);
		const disposables = new DisposableStore();
		disposables.add(activeInstance.onDidRefreshPackagesInstance((packages) => {
			setPackages(packages);
		}));
		disposables.add(activeInstance.onDidChangeRefreshState((isLoading) => {
			setRefreshLoading(isLoading);
		}));
		disposables.add(activeInstance.onDidChangeInstallState((isLoading) => {
			setInstallLoading(isLoading);
		}));
		disposables.add(activeInstance.onDidChangeUpdateState((isLoading) => {
			setUpdateLoading(isLoading);
		}));
		disposables.add(activeInstance.onDidChangeUpdateAllState((isLoading) => {
			setUpdateAllLoading(isLoading);
		}));
		disposables.add(activeInstance.onDidChangeUninstallState((isLoading) => {
			setUninstallLoading(isLoading);
		}));

		return () => disposables.dispose();
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
	const currentFilter = currentQuery.filter;

	// PositronListInstance. The renderer is set later via setItemRenderer so it can close over
	// the latest packages/services state without recreating the instance.
	const [listInstance] = useState(() => new PositronListInstance<ILanguageRuntimePackage>({
		defaultItemHeight: ITEM_HEIGHT,
		itemRenderer: () => null,
	}));

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

		if (debouncedQuery.filter === PackagesFilter.Outdated) {
			result = result.filter((pkg) => pkg.latestVersion && pkg.latestVersion !== pkg.version);
		} else if (debouncedQuery.filter === PackagesFilter.Attached) {
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

	// Show the help page for a package using the active session's language. Falls back to a
	// notification if the help service can't find anything.
	const showHelpForPackage = useCallback(async (packageName: string) => {
		const session = activeInstance?.session;
		if (!session) {
			return;
		}
		const languageId = session.runtimeMetadata.languageId;

		// R: open the package's help index directly. The help comm only knows
		// how to look up help *topics*, so bare "dplyr" usually finds nothing.
		// `help(package = ...)` is the canonical entry point for package-level
		// help; printing the result triggers ark's browseURL hook, which
		// surfaces the page in the help pane.
		if (languageId === 'r') {
			session.execute(
				`help(package = "${packageName}", help_type = "html")`,
				generateUuid(),
				RuntimeCodeExecutionMode.Interactive,
				RuntimeErrorBehavior.Stop,
			);
			return;
		}

		// Default behavior
		const found = await services.positronHelpService.showHelpTopic(languageId, packageName);
		if (!found) {
			services.notificationService.info(
				localize('positronPackages.noHelpFound', "No help found for '{0}'.", packageName)
			);
		}
	}, [activeInstance, services]);

	// Replace the item renderer whenever its closed-over deps change so the latest
	// deduplicatedPackages snapshot is visible to "Copy All" and clicks select via the
	// instance.
	useEffect(() => {
		const renderItem = (pkg: ILanguageRuntimePackage, ctx: PositronListItemContext) => {
			const { name, displayName, version, latestVersion, attached } = pkg;
			const hasUpdate = latestVersion && latestVersion !== version;

			const showRowContextMenu = (anchor: { x: number; y: number }) => {
				services.contextMenuService.showContextMenu({
					getActions: () => [
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

			return (
				// eslint-disable-next-line jsx-a11y/no-static-element-interactions
				<div
					className='packages-list-item'
					onContextMenu={(e) => {
						// Right-click. The data grid's row cell calls e.stopPropagation() on
						// mousedown, so right-click handling lives on contextmenu instead.
						e.preventDefault();
						e.stopPropagation();
						showRowContextMenu({ x: e.clientX, y: e.clientY });
					}}
					onMouseDown={(e) => {
						// Ctrl+Click on macOS acts as right-click for the context menu.
						if (e.button === 0 && isMacintosh && e.ctrlKey) {
							e.stopPropagation();
							showRowContextMenu({ x: e.clientX, y: e.clientY });
						} else if (e.button === 0) {
							// Left click - select via the instance and move browser focus to the
							// data grid waffle so the cursor-outline gating (:focus-within) shows.
							e.stopPropagation();
							listInstance.selectRow(ctx.index);
							(e.currentTarget.closest('.data-grid-waffle') as HTMLElement | null)?.focus();
						}
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
					<div className='packages-list-item-name'>{displayName}</div>
					<div className='packages-list-item-version'>{version}</div>
					{hasUpdate && (
						<div
							className='packages-list-item-update'
							title={localize('positronPackages.updateAvailable', "Update available: {0}", latestVersion)}
						>
							&#x2191;
						</div>
					)}
					{attached === true && (
						<Button
							ariaLabel={localize('positronPackages.showHelpAriaLabel', "Show help for {0}", name)}
							className='packages-list-item-help'
							tooltip={localize('positronPackages.showHelpTooltip', "Show help for {0}", name)}
							onPressed={() => { void showHelpForPackage(name); }}
						>
							<svg fill='currentColor' height='11' viewBox='0 0 16 16' width='11'>
								<path d='M2 2.5A.5.5 0 012.5 2H5c1.1 0 2.1.4 2.9 1.1.7-.7 1.8-1.1 2.9-1.1h2.5a.5.5 0 01.5.5v10a.5.5 0 01-.5.5H11c-1 0-1.9.4-2.5 1.1-.6-.7-1.5-1.1-2.5-1.1H2.5a.5.5 0 01-.5-.5v-10zM7.5 4.1C6.9 3.4 6 3 5 3H3v9h3c.7 0 1.4.2 2 .5.6-.3 1.2-.5 2-.5h2V3h-2c-1 0-1.9.4-2.5 1.1z' />
							</svg>
						</Button>
					)}
				</div>
			);
		};

		listInstance.setItemRenderer(renderItem);
	}, [listInstance, deduplicatedPackages, services, showHelpForPackage]);

	// Enter on the focused row sets selection to that row.
	useEffect(() => {
		const disposable = listInstance.onDidActivate(() => {
			listInstance.selectRow(listInstance.cursorRowIndex);
		});
		return () => disposable.dispose();
	}, [listInstance]);

	// Sync the currently-selected package's name into the packages service. onDidUpdate fires
	// for any instance change (selection, cursor, scroll), so we dedupe before pushing.
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

	// Rewrite the filter input to reflect the selected category filter.
	const selectFilter = (filter: PackagesFilter) => {
		const newText = applyFilterToQuery(queryText, filter);
		filterRef.current?.setFilterText(newText === '' ? '' : `${newText} `);
		filterRef.current?.focus();
	};

	// Build the Filter submenu entries. Evaluated lazily so the checked state
	// reflects the current input when the submenu is opened.
	const filterSubmenuEntries = (): CustomContextMenuEntry[] => [
		new CustomContextMenuItem({
			label: localize('positronPackages.filterByAll', "All Packages"),
			checked: currentFilter === PackagesFilter.All,
			onSelected: () => selectFilter(PackagesFilter.All),
		}),
		new CustomContextMenuItem({
			label: localize('positronPackages.filterByOutdated', "Outdated"),
			checked: currentFilter === PackagesFilter.Outdated,
			onSelected: () => selectFilter(PackagesFilter.Outdated),
		}),
		new CustomContextMenuItem({
			label: localize('positronPackages.filterByAttached', "Attached"),
			checked: currentFilter === PackagesFilter.Attached,
			onSelected: () => selectFilter(PackagesFilter.Attached),
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

	// Only show the "No packages found" message when the user has an active filter query.
	// An unfiltered empty list renders the (empty) data grid, matching prior behavior.
	const emptyListRenderer = debouncedQuery.text
		? () => localize('positronPackages.noPackagesFound', "No packages found.")
		: undefined;

	return (
		<div className='positron-packages-list'>
			<div ref={progressRef} id='packages-progress' />

			<div className='packages-filter-container'>
				<ActionBarFilter
					ref={filterRef}
					showClearAlways
					clearButtonIcon={Codicon.clearAll}
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
