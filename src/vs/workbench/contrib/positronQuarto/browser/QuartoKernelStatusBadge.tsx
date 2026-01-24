/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './QuartoKernelStatusBadge.css';

// React.
import React from 'react';

// Other dependencies.
import { localize } from '../../../../nls.js';
import { MenuId, MenuItemAction, SubmenuItemAction } from '../../../../platform/actions/common/actions.js';
import { ActionBarMenuButton } from '../../../../platform/positronActionBar/browser/components/actionBarMenuButton.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IQuartoKernelManager, QuartoKernelState } from './quartoKernelManager.js';
import { isQuartoOrRmdFile } from '../common/positronQuartoConfig.js';
import { RuntimeStatus, RuntimeStatusIcon } from '../../positronConsole/browser/components/runtimeStatus.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IMenuService } from '../../../../platform/actions/common/actions.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';

/**
 * Map QuartoKernelState to RuntimeStatus for icon display.
 */
const quartoStateToRuntimeStatus: Record<QuartoKernelState, RuntimeStatus> = {
	[QuartoKernelState.None]: RuntimeStatus.Disconnected,
	[QuartoKernelState.Starting]: RuntimeStatus.Active,
	[QuartoKernelState.Ready]: RuntimeStatus.Idle,
	[QuartoKernelState.Busy]: RuntimeStatus.Active,
	[QuartoKernelState.Error]: RuntimeStatus.Disconnected,
	[QuartoKernelState.ShuttingDown]: RuntimeStatus.Active,
};

/**
 * Labels for specific kernel states when no runtime name is available.
 */
const quartoStateToLabel: Partial<Record<QuartoKernelState, string>> = {
	[QuartoKernelState.None]: localize('quartoKernel.state.none', 'No Kernel'),
	[QuartoKernelState.Starting]: localize('quartoKernel.state.starting', 'Starting...'),
	[QuartoKernelState.Error]: localize('quartoKernel.state.error', 'Kernel Error'),
	[QuartoKernelState.ShuttingDown]: localize('quartoKernel.state.shuttingDown', 'Shutting Down'),
};

const tooltip = localize('quartoKernel.statusBadge.tooltip', 'Quarto Kernel Actions');

interface QuartoKernelStatusBadgeProps {
	accessor: ServicesAccessor;
}

/**
 * React component that displays Quarto kernel status in the editor action bar.
 * Shows the current kernel state with an appropriate status icon and label.
 */
export function QuartoKernelStatusBadge({ accessor }: QuartoKernelStatusBadgeProps) {
	// Get services
	const editorService = accessor.get(IEditorService);
	const quartoKernelManager = accessor.get(IQuartoKernelManager);
	const menuService = accessor.get(IMenuService);
	const contextKeyService = accessor.get(IContextKeyService);

	// State
	const [documentUri, setDocumentUri] = React.useState<URI | undefined>(() => {
		const uri = editorService.activeEditor?.resource;
		return isQuartoOrRmdFile(uri?.path) ? uri : undefined;
	});

	const [kernelState, setKernelState] = React.useState<QuartoKernelState>(() => {
		if (documentUri) {
			return quartoKernelManager.getKernelState(documentUri);
		}
		return QuartoKernelState.None;
	});

	const [runtimeName, setRuntimeName] = React.useState<string | undefined>(() => {
		if (documentUri) {
			return quartoKernelManager.getSessionForDocument(documentUri)?.runtimeMetadata.runtimeName;
		}
		return undefined;
	});

	// Set up event listeners
	React.useEffect(() => {
		const disposables = new DisposableStore();

		// Listen for active editor changes
		disposables.add(editorService.onDidActiveEditorChange(() => {
			const uri = editorService.activeEditor?.resource;
			if (isQuartoOrRmdFile(uri?.path)) {
				setDocumentUri(uri);
				setKernelState(quartoKernelManager.getKernelState(uri!));
				const session = quartoKernelManager.getSessionForDocument(uri!);
				setRuntimeName(session?.runtimeMetadata.runtimeName);
			} else {
				setDocumentUri(undefined);
				setKernelState(QuartoKernelState.None);
				setRuntimeName(undefined);
			}
		}));

		// Listen for kernel state changes
		disposables.add(quartoKernelManager.onDidChangeKernelState(e => {
			if (documentUri && e.documentUri.toString() === documentUri.toString()) {
				setKernelState(e.newState);
				setRuntimeName(e.session?.runtimeMetadata.runtimeName);
			}
		}));

		return () => disposables.dispose();
	}, [editorService, quartoKernelManager, documentUri]);

	// Compute display values
	const runtimeStatus = quartoStateToRuntimeStatus[kernelState];
	const label = runtimeName ?? quartoStateToLabel[kernelState] ?? '';

	// Create menu for kernel actions
	const menu = React.useMemo(() => {
		return menuService.createMenu(MenuId.PositronQuartoKernelSubmenu, contextKeyService);
	}, [menuService, contextKeyService]);

	// Clean up menu on unmount
	React.useEffect(() => {
		return () => menu.dispose();
	}, [menu]);

	// Callback to load actions from the menu
	const getActions = React.useCallback(() => {
		const actions: (MenuItemAction | SubmenuItemAction)[] = [];
		for (const [_group, groupActions] of menu.getActions({ shouldForwardArgs: true })) {
			actions.push(...groupActions);
		}
		return actions;
	}, [menu]);

	return (
		<ActionBarMenuButton
			actions={getActions}
			align='left'
			ariaLabel={tooltip}
			tooltip={tooltip}
		>
			<div className='quarto-kernel-status-badge' data-testid='quarto-kernel-status'>
				<RuntimeStatusIcon status={runtimeStatus} />
				<p className='kernel-label'>{label}</p>
			</div>
		</ActionBarMenuButton>
	);
}
