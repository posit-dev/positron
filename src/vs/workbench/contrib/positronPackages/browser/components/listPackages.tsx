/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './listPackages.css';

// React.
import React, {
	CSSProperties,
	useCallback,
	useEffect,
	useRef,
	useState,
} from 'react';

// Other dependencies.
import { FixedSizeList as List } from 'react-window';
import * as DOM from '../../../../../base/browser/dom.js';
import { useStateRef } from '../../../../../base/browser/ui/react/useStateRef.js';
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';
import { ActionBarButton } from '../../../../../platform/positronActionBar/browser/components/actionBarButton.js';
import { ActionBarMenuButton } from '../../../../../platform/positronActionBar/browser/components/actionBarMenuButton.js';
import { ActionBarRegion } from '../../../../../platform/positronActionBar/browser/components/actionBarRegion.js';
import { PositronActionBar } from '../../../../../platform/positronActionBar/browser/positronActionBar.js';
import { PositronActionBarContextProvider } from '../../../../../platform/positronActionBar/browser/positronActionBarContext.js';
import { ViewsProps } from '../positronPackages.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { localize } from '../../../../../nls.js';
import { usePositronPackagesContext } from '../positronPackagesContext.js';
import { ILanguageRuntimePackage, ILanguageRuntimeSession } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { ProgressBar } from '../../../../../base/browser/ui/progressbar/progressbar.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { Separator } from '../../../../../base/common/actions.js';
import { PackagesInstanceMenuButton } from './packagesInstanceMenuButton.js';

const positronRefreshPackages = localize(
	'positronRefreshPackages',
	'Refresh Packages',
);

const positronInstallPackage = localize(
	'positronInstallPackage',
	'Install Package',
);

const positronUninstallPackage = localize(
	'positronUninstallPackage',
	'Uninstall Package',
);

const positronUpdatePackage = localize(
	'positronUpdatePackage',
	'Update Package',
);

const positronUpdateAllPackages = localize(
	'positronUpdateAllPackages',
	'Update All Packages',
);

const positronPackageActions = localize(
	'positronPackageActions',
	'Package Actions',
);

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

	// UI State
	const [focused, setFocused] = useState(false);

	// Selected Item
	const [selectedItem, setSelectedItem] = useState<string | undefined>();

	// Load packages when the active session changes
	useEffect(() => {
		services.commandService.executeCommand('positronPackages.refreshPackages');
	}, [activeInstance, services.commandService]);

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

	// Item renderer
	const ItemEntry = (props: { index: number; style: CSSProperties }) => {
		const itemProps = packages[props.index];
		const { id, name, displayName, version } = itemProps;

		return (
			// eslint-disable-next-line jsx-a11y/no-static-element-interactions
			<div
				className={positronClassNames('packages-list-item', {
					selected: id === selectedItem,
				})}
				style={props.style}
				onMouseDown={(e) => {
					if (e.button === 0) { // Left Click
						// Select the item.
						setSelectedItem(id);
					} else if (e.button === 2) { // Right Click
						// Show the context menu.
						services.contextMenuService.showContextMenu({
							getActions: () => [
								{
									id: 'copy',
									label: localize('positronPackages.copyPackage', "Copy '{0}'", name),
									tooltip: localize('positronPackages.copyPackage', "Copy '{0}'", name),
									class: undefined,
									enabled: true,
									run: () => services.clipboardService.writeText(`${name} ${version}`)
								},
								{
									id: 'copyAll',
									label: localize('positronPackages.copyAllPackages', 'Copy All'),
									tooltip: localize('positronPackages.copyAllPackages', 'Copy All'),
									class: undefined,
									enabled: true,
									run: () => services.clipboardService.writeText(packages.map((pkg) => `${pkg.name} ${pkg.version}`).join('\n'))
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
					}
				}}
			>
				<div>{displayName}</div>
				<div className='description'>{version}</div>
			</div >
		);
	};

	// Map selected item to package name
	const getSelectedItemPackageName = useCallback((item: string | undefined) => {
		return packages.find((pkg) => pkg.id === item)?.name;
	}, [packages]);

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

			<ActionBar
				activeSession={activeInstance?.session}
				busy={loading}
				selectedItem={selectedItem}
				onInstallPackage={() => services.commandService.executeCommand('positronPackages.installPackage')}
				onRefreshPackages={() => services.commandService.executeCommand('positronPackages.refreshPackages')}
				onUninstallPackage={() => {
					const packageName = getSelectedItemPackageName(selectedItem);
					if (packageName) {
						services.commandService.executeCommand('positronPackages.uninstallPackage', packageName);
					}
				}}
				onUpdateAllPackages={() => services.commandService.executeCommand('positronPackages.updateAllPackages')}
				onUpdatePackage={() => {
					const packageName = getSelectedItemPackageName(selectedItem);
					if (packageName) {
						services.commandService.executeCommand('positronPackages.updatePackage', packageName);
					}
				}}
			></ActionBar>
			<div className='packages-list-container'>
				<List
					height={height - ACTION_BAR_HEIGHT}
					innerRef={innerRef}
					itemCount={packages.length}
					itemKey={(index) => packages[index].id}
					itemSize={26}
					width={'calc(100% - 2px)'}
				>
					{ItemEntry}
				</List>
			</div>
		</div >
	);
};

const ACTION_BAR_PADDING_LEFT = 8;
const ACTION_BAR_PADDING_RIGHT = 8;
const ACTION_BAR_HEIGHT = 28;

interface ActionBarProps {
	busy: boolean;
	activeSession?: ILanguageRuntimeSession;
	selectedItem?: string;
	onInstallPackage: () => void;
	onRefreshPackages: () => void;
	onUninstallPackage: () => void;
	onUpdateAllPackages: () => void;
	onUpdatePackage: () => void;
}

const ActionBar = ({
	busy,
	activeSession,
	selectedItem,
	onInstallPackage,
	onRefreshPackages,
	onUpdateAllPackages,
	onUpdatePackage,
	onUninstallPackage,
	...props
}: React.PropsWithChildren<ActionBarProps>) => {
	return (
		<div style={{ height: ACTION_BAR_HEIGHT }}>
			<PositronActionBarContextProvider {...props}>
				<PositronActionBar
					borderBottom={true}
					borderTop={true}
					paddingLeft={ACTION_BAR_PADDING_LEFT}
					paddingRight={ACTION_BAR_PADDING_RIGHT}
				>
					<ActionBarRegion location='left'>
						<PackagesInstanceMenuButton />
					</ActionBarRegion>
					<ActionBarRegion location='right'>
						<ActionBarButton
							align='right'
							ariaLabel={positronRefreshPackages}
							disabled={busy || !activeSession}
							icon={ThemeIcon.fromId('refresh')}
							tooltip={positronRefreshPackages}
							onPressed={onRefreshPackages}
						/>
						<ActionBarMenuButton
							actions={() => [
								{
									id: 'positron.packages.installPackage',
									label: positronInstallPackage,
									tooltip: positronInstallPackage,
									class: undefined,
									enabled: !busy,
									run: onInstallPackage,
								},
								{
									id: 'positron.packages.updateAllPackages',
									label: positronUpdateAllPackages,
									tooltip: positronUpdateAllPackages,
									class: undefined,
									enabled: !busy,
									run: onUpdateAllPackages,
								},
								{
									id: 'positron.packages.updatePackage',
									label: positronUpdatePackage,
									tooltip: positronUpdatePackage,
									class: undefined,
									enabled: !busy && Boolean(selectedItem),
									run: onUpdatePackage,
								},
								{
									id: 'positron.packages.uninstallPackage',
									label: positronUninstallPackage,
									tooltip: positronUninstallPackage,
									class: undefined,
									enabled: !busy && Boolean(selectedItem),
									run: onUninstallPackage,
								},
							]}
							align='right'
							ariaLabel={positronPackageActions}
							disabled={!activeSession}
							dropdownIndicator='disabled'
							icon={ThemeIcon.fromId('ellipsis')}
							tooltip={positronPackageActions}
						/>
					</ActionBarRegion>
				</PositronActionBar>
			</PositronActionBarContextProvider>
		</div>
	);
};
