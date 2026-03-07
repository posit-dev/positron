/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './actionBars.css';

// React.
import { PropsWithChildren, useEffect, useLayoutEffect, useRef, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { PositronActionBar } from '../../../../../platform/positronActionBar/browser/positronActionBar.js';
import { ActionBarRegion } from '../../../../../platform/positronActionBar/browser/components/actionBarRegion.js';
import { ActionBarButton } from '../../../../../platform/positronActionBar/browser/components/actionBarButton.js';
import { ActionBarFilter, ActionBarFilterHandle } from '../../../../../platform/positronActionBar/browser/components/actionBarFilter.js';
import { SortingMenuButton } from './sortingMenuButton.js';
import { GroupingMenuButton } from './groupingMenuButton.js';
import { MemoryUsageMeter, MEMORY_METER_FIXED_WIDTH, MEMORY_METER_COMPACT_FIXED_WIDTH } from './memoryUsageMeter.js';
import { PositronActionBarContextProvider } from '../../../../../platform/positronActionBar/browser/positronActionBarContext.js';
import { usePositronVariablesContext } from '../positronVariablesContext.js';
import { VariablesInstanceMenuButton } from './variablesInstanceMenuButton.js';
import { DeleteAllVariablesModalDialog } from '../modalDialogs/deleteAllVariablesModalDialog.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { PositronModalReactRenderer } from '../../../../../base/browser/positronModalReactRenderer.js';
import { ByteSize } from '../../../../../platform/files/common/files.js';
import { DisposableStore, toDisposable } from '../../../../../base/common/lifecycle.js';
import { IMemoryUsageSnapshot } from '../../../../../platform/positronMemoryUsage/common/positronMemoryUsage.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { PositronDynamicActionBar, DynamicActionBarAction, DEFAULT_ACTION_BAR_BUTTON_WIDTH, DEFAULT_ACTION_BAR_DROPDOWN_BUTTON_WIDTH, DEFAULT_ACTION_BAR_SEPARATOR_WIDTH } from '../../../../../platform/positronActionBar/browser/positronDynamicActionBar.js';

// Constants.
const kSecondaryActionBarGap = 4;
const kPaddingLeft = 8;
const kPaddingRight = 8;
const kFilterTimeout = 800;

/**
 * Localized strings.
 */
const positronRefreshObjects = localize('positronRefreshObjects', "Refresh objects");
const positronDeleteAllObjects = localize('positronDeleteAllObjects', "Delete all objects");

/**
 * ActionBars component.
 * @param props An ActionBarsProps that contains the component properties.
 * @returns The rendered component.
 */
export const ActionBars = (props: PropsWithChildren<{}>) => {
	// Context hooks.
	const positronVariablesContext = usePositronVariablesContext();
	const services = usePositronReactServicesContext();

	// State hooks.
	const [filterText, setFilterText] = useState(positronVariablesContext.activePositronVariablesInstance?.getFilterText() ?? '');
	const filterRef = useRef<ActionBarFilterHandle>(null);
	const prevActiveInstance = useRef(positronVariablesContext.activePositronVariablesInstance);

	// Track the action bar container width so we can decide whether to
	// include the memory meter before passing actions to the
	// DynamicActionBar. This avoids the meter getting highest layout
	// priority simply because it is first in the visual order.
	const actionBarsRef = useRef<HTMLDivElement>(null);
	const [actionBarWidth, setActionBarWidth] = useState(0);

	useLayoutEffect(() => {
		const el = actionBarsRef.current;
		if (!el) {
			return;
		}
		const disposables = new DisposableStore();
		setActionBarWidth(el.offsetWidth);
		const observer = new ResizeObserver(() => {
			setActionBarWidth(el.offsetWidth);
		});
		observer.observe(el);
		disposables.add(toDisposable(() => observer.disconnect()));
		return () => disposables.dispose();
	}, []);

	// Whether the memory usage feature is enabled.
	const [memoryEnabled, setMemoryEnabled] = useState(
		() => services.positronMemoryUsageService.enabled
	);

	// Memory usage snapshot state (lifted up so we can pass the label text
	// to the DynamicActionBarAction for width measurement).
	const [memorySnapshot, setMemorySnapshot] = useState<IMemoryUsageSnapshot | undefined>(
		() => services.positronMemoryUsageService.currentSnapshot
	);

	// Subscribe to memory usage updates and enabled state changes.
	useEffect(() => {
		const disposables = new DisposableStore();
		disposables.add(services.positronMemoryUsageService.onDidUpdateMemoryUsage(s => {
			setMemorySnapshot(s);
		}));
		disposables.add(services.positronMemoryUsageService.onDidChangeEnabled(enabled => {
			setMemoryEnabled(enabled);
			if (!enabled) {
				setMemorySnapshot(undefined);
			}
		}));
		return () => disposables.dispose();
	}, [services.positronMemoryUsageService]);

	// Find text change handler.
	useEffect(() => {

		const instanceChanged = positronVariablesContext.activePositronVariablesInstance !== prevActiveInstance.current;

		if (instanceChanged) {
			prevActiveInstance.current = positronVariablesContext.activePositronVariablesInstance;
			// This will trigger a setFilterText, which causes this effect to re-run.
			// However it will be a no-op since the filter text is already set in the variable instance.
			filterRef.current?.setFilterText(positronVariablesContext.activePositronVariablesInstance?.getFilterText() ?? '');
			return;
		}

		if (filterText === '') {
			positronVariablesContext.activePositronVariablesInstance?.setFilterText('');
			return;
		} else {
			// Start the filter timeout.
			const filterTimeout = setTimeout(() => {
				positronVariablesContext.activePositronVariablesInstance?.setFilterText(
					filterText
				);
			}, kFilterTimeout);

			// Clear the find timeout.
			return () => clearTimeout(filterTimeout);
		}
	}, [filterText, positronVariablesContext.activePositronVariablesInstance]);

	/**
	 * Delete all objects event handler.
	 */
	const deleteAllObjectsHandler = async () => {
		// Create the renderer.
		const renderer = new PositronModalReactRenderer();

		// Show the delete all variables modal dialog.
		renderer.render(
			<DeleteAllVariablesModalDialog
				deleteAllVariablesAction={async deleteAllVariablesResult =>
					positronVariablesContext.activePositronVariablesInstance?.requestClear(
						deleteAllVariablesResult.includeHiddenObjects
					)
				}
				renderer={renderer}
			/>
		);
	};

	/**
	 * Refresh objects event handler
	 */
	const refreshObjectsHandler = () => {
		positronVariablesContext.activePositronVariablesInstance?.requestRefresh();
	};

	// If there are no instances, return null.
	// TODO@softwarenerd - Render something specific for this case. TBD.
	if (positronVariablesContext.positronVariablesInstances.length === 0) {
		return null;
	}

	// Build left actions for the primary action bar.
	const leftActions: DynamicActionBarAction[] = [
		{
			fixedWidth: DEFAULT_ACTION_BAR_DROPDOWN_BUTTON_WIDTH,
			separator: false,
			component: <GroupingMenuButton />
		},
		{
			fixedWidth: DEFAULT_ACTION_BAR_DROPDOWN_BUTTON_WIDTH,
			separator: false,
			component: <SortingMenuButton />
		},
	];

	// Build right actions for the primary action bar.
	// The memory meter is first for visual ordering (meter | refresh | clear).
	const rightActions: DynamicActionBarAction[] = [];

	// Compute the minimum width needed for all actions *without* the meter:
	// left actions + right actions + separators + overflow button + padding.
	const baseWidth =
		(DEFAULT_ACTION_BAR_DROPDOWN_BUTTON_WIDTH * 2) + // grouping + sorting
		(DEFAULT_ACTION_BAR_BUTTON_WIDTH * 2) +          // refresh + delete
		(DEFAULT_ACTION_BAR_SEPARATOR_WIDTH * 1) +        // separator between refresh and delete
		DEFAULT_ACTION_BAR_BUTTON_WIDTH +                 // overflow button reserved by DynamicActionBar
		kPaddingLeft + kPaddingRight;

	// Include the memory meter when enabled and the action bar is wide enough.
	// Three visual states: full (bar + label), compact (label only), hidden.
	// When no snapshot is available yet, show in loading state with "Mem" label.
	if (memoryEnabled) {
		const loading = !memorySnapshot;
		const sizeLabel = loading
			? 'Mem'
			: ByteSize.formatSize(
				memorySnapshot.kernelTotalBytes +
				memorySnapshot.positronOverheadBytes +
				memorySnapshot.extensionHostOverheadBytes
			);
		// Approximate the text width at 12px font. The DynamicActionBar
		// measures precisely via Canvas; this just needs to be close enough
		// for the show/hide threshold (slightly under is fine -- the
		// DynamicActionBar handles overflow gracefully if we're off by a few px).
		const textWidth = sizeLabel.length * 5.5;
		const fullMeterWidth = MEMORY_METER_FIXED_WIDTH + textWidth + DEFAULT_ACTION_BAR_SEPARATOR_WIDTH;
		const compactMeterWidth = MEMORY_METER_COMPACT_FIXED_WIDTH + textWidth + DEFAULT_ACTION_BAR_SEPARATOR_WIDTH;

		if (actionBarWidth >= baseWidth + fullMeterWidth) {
			// Full meter: bar + label + arrow.
			rightActions.push({
				fixedWidth: MEMORY_METER_FIXED_WIDTH,
				text: sizeLabel,
				separator: true,
				component: <MemoryUsageMeter loading={loading} snapshot={memorySnapshot} />
			});
		} else if (actionBarWidth >= baseWidth + compactMeterWidth) {
			// Compact meter: label + arrow only (no bar).
			rightActions.push({
				fixedWidth: MEMORY_METER_COMPACT_FIXED_WIDTH,
				text: sizeLabel,
				separator: true,
				component: <MemoryUsageMeter compact loading={loading} snapshot={memorySnapshot} />
			});
		}
		// Otherwise: hidden entirely.
	}

	rightActions.push(
		{
			fixedWidth: DEFAULT_ACTION_BAR_BUTTON_WIDTH,
			separator: true,
			component: (
				<ActionBarButton
					align='right'
					ariaLabel={positronRefreshObjects}
					icon={Codicon.positronRefresh}
					tooltip={positronRefreshObjects}
					onPressed={refreshObjectsHandler}
				/>
			),
			overflowContextMenuItem: {
				commandId: 'positron.refreshObjects',
				icon: Codicon.positronRefresh,
				label: positronRefreshObjects,
				onSelected: refreshObjectsHandler
			}
		},
		{
			fixedWidth: DEFAULT_ACTION_BAR_BUTTON_WIDTH,
			separator: false,
			component: (
				<ActionBarButton
					align='right'
					ariaLabel={positronDeleteAllObjects}
					icon={Codicon.clearAll}
					tooltip={positronDeleteAllObjects}
					onPressed={deleteAllObjectsHandler}
				/>
			),
			overflowContextMenuItem: {
				commandId: 'positron.deleteAllObjects',
				icon: Codicon.clearAll,
				label: positronDeleteAllObjects,
				onSelected: deleteAllObjectsHandler
			}
		},
	);

	// Render.
	return (
		<PositronActionBarContextProvider {...props}>
			<div ref={actionBarsRef} className='action-bars'>
				<PositronDynamicActionBar
					borderBottom={true}
					borderTop={true}
					leftActions={leftActions}
					paddingLeft={kPaddingLeft}
					paddingRight={kPaddingRight}
					rightActions={rightActions}
				/>
				<PositronActionBar
					borderBottom={true}
					gap={kSecondaryActionBarGap}
					paddingLeft={kPaddingLeft}
					paddingRight={kPaddingRight}
				>
					<ActionBarRegion location='left'>
						<VariablesInstanceMenuButton />
					</ActionBarRegion>
					<ActionBarRegion location='right'>
						<ActionBarFilter
							ref={filterRef}
							initialFilterText={filterText}
							width={150}
							onFilterTextChanged={filterText => setFilterText(filterText)} />
					</ActionBarRegion>
				</PositronActionBar>
			</div>
		</PositronActionBarContextProvider>
	);
};
