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
import { applySortToQuery, PackagesSortOrder, parseQuery } from './packagesQuery.js';

const positronUninstallPackage = localize(
	'positronUninstallPackage',
	'Uninstall Package',
);

const positronUpdatePackage = localize(
	'positronUpdatePackage',
	'Update Package',
);

/**
 * Base/recommended R packages are reported with installedFrom === 'R' by Ark
 * (priority "base" or "recommended"). They're effectively always attached and
 * unloading them can crash the session, so we render the indicator as
 * non-interactive for those rows.
 */
const isProtectedPackage = (pkg: ILanguageRuntimePackage): boolean =>
	pkg.installedFrom === 'R';

// Height of the filter container in pixels
const FILTER_HEIGHT = 34;

// Row heights for each item size mode.
const ROW_ITEM_HEIGHT = 26;
const CARD_ITEM_HEIGHT = 72;

export const ListPackages = (props: React.PropsWithChildren<ViewsProps>) => {
	const {
		activeInstance,
	} = usePositronPackagesContext();
	const { height, reactComponentContainer } = props;
	const services = usePositronReactServicesContext();

	const [packages, setPackages] = useState<ILanguageRuntimePackage[]>([]);

	/**
	 * Optimistic overrides for the loaded indicator, keyed by package name.
	 * Set on click before the kernel call returns, then cleared on the next
	 * refresh so the UI snaps back to the truth.
	 */
	const [optimisticLoaded, setOptimisticLoaded] = useState<Map<string, boolean>>(new Map());

	// Whether the active runtime supports unloading (R does, Python doesn't).
	const canUnload = activeInstance?.canUnloadPackages ?? false;

	// Item size mode ('card' or 'row'), driven by the packages service.
	const [itemSize, setItemSize] = useState(() => services.positronPackagesService.itemSize);
	useEffect(() => {
		const disposable = services.positronPackagesService.onDidChangeItemSize((size) => {
			setItemSize(size);
		});
		return () => disposable.dispose();
	}, [services.positronPackagesService]);

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
			// Refresh just delivered ground truth; drop optimistic overrides.
			setOptimisticLoaded(new Map());
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

	// Current sort derived from the immediate (non-debounced) query so the
	// sort menu's checked state updates without waiting for the debounce.
	const currentSort = useMemo(() => parseQuery(queryText).sort, [queryText]);

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

	// Deduplicate packages by name, keeping only the first occurrence, and
	// overlay any optimistic `loaded` overrides so the dot reflects the
	// pending click before the next refresh confirms it.
	const deduplicatedPackages = useMemo(() => {
		const seen = new Set<string>();
		return packages
			.filter((pkg) => {
				if (seen.has(pkg.name)) {
					return false;
				}
				seen.add(pkg.name);
				return true;
			})
			.map((pkg) => {
				const override = optimisticLoaded.get(pkg.name);
				return override === undefined ? pkg : { ...pkg, loaded: override };
			});
	}, [packages, optimisticLoaded]);

	// Parse the debounced query so filtering and sorting run off the same snapshot.
	const debouncedQuery = useMemo(() => parseQuery(debouncedQueryText), [debouncedQueryText]);

	// Filter packages based on the debounced free-text (case-insensitive, matches
	// name, displayName, description, or author) and sort according to the
	// current sort order. `@loaded` narrows to attached packages only.
	const filteredPackages = useMemo(() => {
		let result = deduplicatedPackages;

		if (debouncedQuery.loadedOnly) {
			result = result.filter((pkg) => pkg.loaded === true);
		}

		if (debouncedQuery.text) {
			const lowerFilter = debouncedQuery.text.toLowerCase();
			result = result.filter((pkg) =>
				pkg.name.toLowerCase().includes(lowerFilter) ||
				pkg.displayName.toLowerCase().includes(lowerFilter) ||
				(pkg.description?.toLowerCase().includes(lowerFilter) ?? false) ||
				(pkg.author?.toLowerCase().includes(lowerFilter) ?? false)
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

	// Toggle the loaded state for a package: optimistically flip the dot,
	// fire the load/unload via the service, and rely on the next refresh to
	// confirm. On error, revert and show the kernel's message as a toast.
	// `importName` is preferred for the runtime call (Python's Pillow → PIL).
	const toggleLoaded = async (pkg: ILanguageRuntimePackage) => {
		if (isProtectedPackage(pkg)) {
			return;
		}
		// Python doesn't expose unloadPackage; clicking a loaded Python row
		// is a no-op. R supports both directions.
		const isLoaded = pkg.loaded ?? false;
		if (isLoaded && !canUnload) {
			return;
		}
		const next = !isLoaded;
		const loadName = pkg.importName ?? pkg.name;
		setOptimisticLoaded((prev) => {
			const updated = new Map(prev);
			updated.set(pkg.name, next);
			return updated;
		});
		try {
			if (next) {
				await services.positronPackagesService.loadPackage(loadName);
			} else {
				await services.positronPackagesService.unloadPackage(loadName);
			}
		} catch (err) {
			// Revert just this package's optimistic entry; refresh will re-sync.
			setOptimisticLoaded((prev) => {
				const updated = new Map(prev);
				updated.delete(pkg.name);
				return updated;
			});
			const message = err instanceof Error ? err.message : String(err);
			services.notificationService.error(
				next
					? localize('positronPackages.loadFailed', "Failed to load package '{0}': {1}", pkg.name, message)
					: localize('positronPackages.unloadFailed', "Failed to unload package '{0}': {1}", pkg.name, message),
			);
		}
	};

	// Item renderer
	const ItemEntry = (props: { index: number; style: CSSProperties }) => {
		const itemProps = filteredPackages[props.index];
		const { id, name, displayName, version, latestVersion, description, author, loaded } = itemProps;
		const protectedPkg = isProtectedPackage(itemProps);

		// Check if package has an update available
		const hasUpdate = latestVersion && latestVersion !== version;

		return (
			// eslint-disable-next-line jsx-a11y/no-static-element-interactions
			<div
				className={positronClassNames('packages-list-item', `item-size-${itemSize}`, {
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
				{loaded !== undefined && (() => {
					// Loaded + can't unload (Python) = status only, no click affordance.
					const interactive = !protectedPkg && !(loaded && !canUnload);
					const tooltip = protectedPkg
						? localize('positronPackages.protectedTooltip', "Base R package (always loaded)")
						: loaded && !canUnload
							? localize('positronPackages.loadedReadOnlyTooltip', "{0} is loaded", name)
							: loaded
								? localize('positronPackages.unloadTooltip', "Click to unload {0}", name)
								: localize('positronPackages.loadTooltip', "Click to load {0}", name);
					return (
						<button
							aria-label={loaded
								? localize('positronPackages.loadedAriaLabel', "{0} is loaded", name)
								: localize('positronPackages.notLoadedAriaLabel', "{0} is not loaded; click to load", name)}
							className={positronClassNames(
								'packages-list-item-loaded',
								{ loaded, protected: protectedPkg, 'read-only': loaded && !canUnload },
							)}
							disabled={!interactive}
							title={tooltip}
							type='button'
							onClick={(e) => {
								if (!interactive) {
									return;
								}
								// Don't let the click bubble into the row's
								// onMouseDown selection / context-menu logic.
								e.stopPropagation();
								toggleLoaded(itemProps);
							}}
							onMouseDown={(e) => {
								// Prevent the parent's mousedown from running (which
								// would change selection or open the context menu).
								e.stopPropagation();
							}}
						/>
					);
				})()}
				<div className='packages-list-item-body'>
					<div className='packages-list-item-header'>
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
					</div>
					{itemSize === 'card' && (
						<>
							<div className='packages-list-item-description' title={description ?? ''}>
								{description ?? ''}
							</div>
							<div className='packages-list-item-author' title={author ?? ''}>
								{author ?? ''}
							</div>
						</>
					)}
				</div>
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
	// and re-derives every dependent state.
	const selectSort = (sort: PackagesSortOrder) => {
		filterRef.current?.setFilterText(applySortToQuery(queryText, sort));
	};

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
						height={height - FILTER_HEIGHT}
						innerRef={innerRef}
						itemCount={filteredPackages.length}
						itemKey={(index) => filteredPackages[index].id}
						itemSize={itemSize === 'card' ? CARD_ITEM_HEIGHT : ROW_ITEM_HEIGHT}
						style={{ overflowX: 'hidden' }}
						width={'calc(100% - 2px)'}
					>
						{ItemEntry}
					</List>
				)}
			</div>
		</div>
	);
};
