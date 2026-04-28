/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './listPackages.css';

// React.
import React, {
	CSSProperties,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';

// Other dependencies.
import { FixedSizeList as List } from 'react-window';
import * as DOM from '../../../../../base/browser/dom.js';
import { isMacintosh } from '../../../../../base/common/platform.js';
import { useStateRef } from '../../../../../base/browser/ui/react/useStateRef.js';
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';
import { ActionBarFilter, ActionBarFilterHandle } from '../../../../../platform/positronActionBar/browser/components/actionBarFilter.js';
import { ViewsProps } from '../positronPackages.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { Separator } from '../../../../../base/common/actions.js';
import { localize } from '../../../../../nls.js';
import { usePositronPackagesContext } from '../positronPackagesContext.js';
import { ILanguageRuntimePackage } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { ProgressBar } from '../../../../../base/browser/ui/progressbar/progressbar.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { showCustomContextMenu, CustomContextMenuSubmenu, CustomContextMenuEntry } from '../../../../browser/positronComponents/customContextMenu/customContextMenu.js';
import { CustomContextMenuItem } from '../../../../browser/positronComponents/customContextMenu/customContextMenuItem.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { applyFilterToQuery, applySortToQuery, PackagesFilter, PackagesSortOrder, parseQuery } from './packagesQuery.js';

const positronUninstallPackage = localize(
	'positronUninstallPackage',
	'Uninstall Package',
);

const positronUpdatePackage = localize(
	'positronUpdatePackage',
	'Update Package',
);

// Height of the filter container in pixels
const FILTER_HEIGHT = 34;

export const ListPackages = (props: React.PropsWithChildren<ViewsProps>) => {
	const {
		activeInstance,
	} = usePositronPackagesContext();
	const { height, reactComponentContainer } = props;
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

	// Clear selection when filter text changes.
	const handleFilterTextChanged = (text: string) => {
		setQueryText(text);
		setSelectedItem(undefined);
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

	// UI State
	const [focused, setFocused] = useState(false);

	// Selected Item
	const [selectedItem, setSelectedItem] = useState<string | undefined>();

	// We're required to save the scroll state because browsers will automatically
	// scrollTop when an object becomes visible again.
	const [, setScrollState, scrollStateRef] = useStateRef<number[] | undefined>(
		undefined,
	);
	const innerRef = useRef<HTMLElement>(undefined!);

	const [visible, setVisible] = useState(true);
	useEffect(() => {
		const disposableStore = new DisposableStore();
		disposableStore.add(
			reactComponentContainer.onSaveScrollPosition(() => {
				if (innerRef.current) {
					setScrollState(DOM.saveParentsScrollTop(innerRef.current));
				}
			}),
		);
		disposableStore.add(
			reactComponentContainer.onRestoreScrollPosition(() => {
				if (scrollStateRef.current) {
					if (innerRef.current) {
						DOM.restoreParentsScrollTop(
							innerRef.current,
							scrollStateRef.current,
						);
					}
					setScrollState(undefined);
				}
			}),
		);
		return () => disposableStore.dispose();
	}, [reactComponentContainer, scrollStateRef, setScrollState]);

	// Item renderer
	const ItemEntry = (props: { index: number; style: CSSProperties }) => {
		const itemProps = filteredPackages[props.index];
		const { id, name, displayName, version, latestVersion } = itemProps;

		// Check if package has an update available
		const hasUpdate = latestVersion && latestVersion !== version;

		return (
			// eslint-disable-next-line jsx-a11y/no-static-element-interactions
			<div
				className={positronClassNames('packages-list-item', {
					selected: id === selectedItem,
				})}
				style={props.style}
				onMouseDown={(e) => {
					// Show context menu on right-click or Ctrl+Click on macOS
					if ((e.button === 0 && isMacintosh && e.ctrlKey) || e.button === 2) {
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
							getAnchor: () => ({ x: e.clientX, y: e.clientY })
						});
					} else if (e.button === 0) {
						// Left click without Ctrl on Mac - select the item
						setSelectedItem(id);
					}
				}}
			>
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
			</div >
		);
	};

	// Update selected package in the service when selection changes
	useEffect(() => {
		// Find the package name from the selected item id
		const selectedPackageName = selectedItem
			? deduplicatedPackages.find((pkg) => pkg.id === selectedItem)?.name
			: undefined;
		services.positronPackagesService.setSelectedPackage(selectedPackageName);
		return () => services.positronPackagesService.setSelectedPackage(undefined);
	}, [selectedItem, deduplicatedPackages, services.positronPackagesService]);

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

	return (
		// eslint-disable-next-line jsx-a11y/no-static-element-interactions
		<div
			className={positronClassNames('positron-packages-list', {
				focused,
			})}
			tabIndex={0}
			onBlur={() => setFocused(false)}
			onFocus={() => setFocused(true)}
		>
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
				{filteredPackages.length === 0 && debouncedQuery.text ? (
					<div className='packages-empty-message'
						style={{ height: height - FILTER_HEIGHT }}>
						{localize('positronPackages.noPackagesFound', "No packages found.")}
					</div>
				) : (
					<List
						key={visible ? 'visible' : 'hidden'}
						height={height - FILTER_HEIGHT}
						innerRef={innerRef}
						itemCount={filteredPackages.length}
						itemKey={(index) => filteredPackages[index].id}
						itemSize={26}
						overscanCount={10}
						width={'calc(100% - 2px)'}
					>
						{ItemEntry}
					</List>
				)}
			</div>
		</div>
	);
};
