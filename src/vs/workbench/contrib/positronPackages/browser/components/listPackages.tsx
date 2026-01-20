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
import { ActionBarRegion } from '../../../../../platform/positronActionBar/browser/components/actionBarRegion.js';
import { PositronActionBar } from '../../../../../platform/positronActionBar/browser/positronActionBar.js';
import { PositronActionBarContextProvider } from '../../../../../platform/positronActionBar/browser/positronActionBarContext.js';
import { ViewsProps } from '../positronPackages.js';
// import { languageIdToName } from './schemaNavigation.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { localize } from '../../../../../nls.js';
import { usePositronPackagesContext } from '../positronPackagesContext.js';
import { ILanguageRuntimeSession } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { ProgressBar } from '../../../../../base/browser/ui/progressbar/progressbar.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import Severity from '../../../../../base/common/severity.js';

const positronRefreshObjects = localize(
	'positronRefreshObjects',
	'Refresh objects',
);

export const ListPackages = (props: React.PropsWithChildren<ViewsProps>) => {
	const {
		activeSession,
		packages: packagesMap,
		refreshPackages,
	} = usePositronPackagesContext();
	const { height, reactComponentContainer } = props;
	const services = usePositronReactServicesContext();

	// List
	const key = activeSession?.metadata.sessionId ?? '';
	const packages = packagesMap[key] || [];

	// Progress Bar
	const progressRef = useRef<HTMLDivElement>(null);
	const [loading, setLoading] = useState<number>(0);

	const doRefreshPackages = useCallback(
		async (session?: ILanguageRuntimeSession) => {
			if (!session) {
				throw new Error('No active session to refresh packages.');
			}

			try {
				setLoading((i) => i + 1);
				await refreshPackages(session.metadata.sessionId);
			} finally {
				setLoading((i) => i - 1);
			}
		},
		[refreshPackages],
	);

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

		if (loading > 0) {
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
		doRefreshPackages(activeSession);
	}, [activeSession, doRefreshPackages]);

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
		const key = activeSession?.metadata.sessionId ?? '';
		const packages = packagesMap[key] || [];
		const itemProps = packages[props.index];
		const { id, displayName, version } = itemProps;

		return (
			<div
				className={positronClassNames('packages-list-item', {
					selected: id === selectedItem,
				})}
				style={props.style}
				onMouseDown={() => {
					setSelectedItem(id);
				}}
			>
				<div>{displayName}</div>
				<div className='description'>{version}</div>
			</div>
		);
	};

	return (
		<div
			className={positronClassNames('positron-packages-list', {
				focused,
			})}
			tabIndex={0}
			onBlur={() => setFocused(false)}
			onFocus={() => setFocused(true)}
		>
			<div ref={progressRef} id='variables-progress' />

			<ActionBar
				activeSession={activeSession}
				onRefreshPackages={async () => {
					if (loading > 0) {
						return;
					}
					setSelectedItem(undefined);
					try {
						await doRefreshPackages(activeSession);
					} catch (err) {
						services.notificationService.notify({
							message: `Failed to refresh packages: ${err.message}`,
							severity: Severity.Error,
							source: 'Packages',
						});
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
		</div>
	);
};

const ACTION_BAR_PADDING_LEFT = 8;
const ACTION_BAR_PADDING_RIGHT = 8;
const ACTION_BAR_HEIGHT = 28;

interface ActionBarProps {
	onRefreshPackages: () => void;
	activeSession?: ILanguageRuntimeSession;
}

const ActionBar = ({
	activeSession,
	onRefreshPackages,
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
						<ActionBarButton
							align='left'
							ariaLabel=''
							label={activeSession?.getLabel() ?? 'No active session'}
							tooltip={''}
						/>
					</ActionBarRegion>
					<ActionBarRegion location='right'>
						<ActionBarButton
							align='right'
							ariaLabel={positronRefreshObjects}
							icon={ThemeIcon.fromId('positron-refresh')}
							tooltip={positronRefreshObjects}
							onPressed={onRefreshPackages}
						/>
					</ActionBarRegion>
				</PositronActionBar>
			</PositronActionBarContextProvider>
		</div>
	);
};
