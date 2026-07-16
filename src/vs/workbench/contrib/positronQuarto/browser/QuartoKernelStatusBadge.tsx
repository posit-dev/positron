/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './QuartoKernelStatusBadge.css';

// React.
import React from 'react';

// Other dependencies.
import { localize } from '../../../../nls.js';
import { IMenuService, MenuId, MenuItemAction, SubmenuItemAction } from '../../../../platform/actions/common/actions.js';
import { ActionBarMenuButton } from '../../../../platform/positronActionBar/browser/components/actionBarMenuButton.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IQuartoKernelManager, QuartoKernelState } from './quartoKernelManager.js';
import { isQuartoDocument } from '../common/positronQuartoConfig.js';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { RuntimeStatusIcon } from '../../positronConsole/browser/components/runtimeStatus.js';
import { runtimeStateToRuntimeStatus, RuntimeStatus } from '../../positronConsole/common/sessionDisplayUtils.js';
import { useSessionRuntimeState } from '../../positronConsole/browser/components/useSessionRuntimeState.js';
import { type ILanguageRuntimeSession } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { ILanguageRuntimeService } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';

/**
 * Fallback RuntimeStatus for kernel states that fire without a session
 * attached. The kernel manager sets `Starting` before the session object is
 * created and `ShuttingDown` after it's torn down (e.g., during a restart),
 * so those states need explicit mappings to avoid a Disconnected icon.
 * Once a session is attached, its RuntimeState is authoritative and this
 * fallback isn't needed.
 */
const quartoStateToRuntimeStatus: Partial<Record<QuartoKernelState, RuntimeStatus>> = {
	[QuartoKernelState.None]: RuntimeStatus.Disconnected,
	[QuartoKernelState.Starting]: RuntimeStatus.Active,
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
 * Helper function to get URI and language ID from the active editor.
 * Returns undefined if the active editor is not a Quarto document.
 */
function getQuartoDocumentFromEditor(editorService: IEditorService): URI | undefined {
	const uri = editorService.activeEditor?.resource;
	const activeEditor = editorService.activeTextEditorControl;

	// Get language ID from the editor model if available
	let languageId: string | undefined;
	if (activeEditor && 'getModel' in activeEditor) {
		const model = (activeEditor as ICodeEditor).getModel();
		languageId = model?.getLanguageId();
	}

	// Check if this is a Quarto document (by extension or language ID)
	return isQuartoDocument(uri?.path, languageId) ? uri : undefined;
}

/**
 * React component that displays Quarto kernel status in the editor action bar.
 * Shows the current kernel state with an appropriate status icon and label.
 * Derives display status from the session's RuntimeState (via useSessionRuntimeState)
 * when a session is attached, falling back to the QuartoKernelState enum only for
 * pre-session cases (None, Error).
 */
export function QuartoKernelStatusBadge({ accessor }: QuartoKernelStatusBadgeProps) {
	// Get services
	const editorService = accessor.get(IEditorService);
	const quartoKernelManager = accessor.get(IQuartoKernelManager);
	const menuService = accessor.get(IMenuService);
	const contextKeyService = accessor.get(IContextKeyService);
	const languageRuntimeService = accessor.get(ILanguageRuntimeService);

	// State
	const [documentUri, setDocumentUri] = React.useState<URI | undefined>(() =>
		getQuartoDocumentFromEditor(editorService));
	const [kernelState, setKernelState] = React.useState<QuartoKernelState>(() =>
		documentUri ? quartoKernelManager.getKernelState(documentUri) : QuartoKernelState.None);
	const [session, setSession] = React.useState<ILanguageRuntimeSession | undefined>(() =>
		documentUri ? quartoKernelManager.getSessionForDocument(documentUri) : undefined);
	// Name of the interpreter that would start if code were run, shown when no
	// kernel is running yet (e.g. in a Quarto preview editor).
	const [preferredRuntimeName, setPreferredRuntimeName] = React.useState<string | undefined>(() =>
		documentUri ? quartoKernelManager.getPreferredRuntimeForDocument(documentUri)?.runtimeName : undefined);

	// Subscribe to the session's runtime state via the shared hook.
	const runtimeState = useSessionRuntimeState(session);

	// Set up event listeners
	React.useEffect(() => {
		const disposables = new DisposableStore();

		// Recompute the prospective interpreter name for the current document.
		const refreshPreferredRuntime = () => {
			setPreferredRuntimeName(documentUri
				? quartoKernelManager.getPreferredRuntimeForDocument(documentUri)?.runtimeName
				: undefined);
		};

		// Listen for active editor changes
		disposables.add(editorService.onDidActiveEditorChange(() => {
			const quartoUri = getQuartoDocumentFromEditor(editorService);
			if (quartoUri) {
				setDocumentUri(quartoUri);
				setKernelState(quartoKernelManager.getKernelState(quartoUri));
				setSession(quartoKernelManager.getSessionForDocument(quartoUri));
			} else {
				setDocumentUri(undefined);
				setKernelState(QuartoKernelState.None);
				setSession(undefined);
			}
		}));

		// Listen for kernel state changes
		disposables.add(quartoKernelManager.onDidChangeKernelState(e => {
			if (documentUri && e.documentUri.toString() === documentUri.toString()) {
				setKernelState(e.newState);
				setSession(e.session);
				refreshPreferredRuntime();
			}
		}));

		// The preferred interpreter can change as runtimes are discovered or
		// registered (which may finish after the editor opens), so recompute
		// the prospective name when that happens.
		disposables.add(languageRuntimeService.onDidRegisterRuntime(refreshPreferredRuntime));
		disposables.add(languageRuntimeService.onDidChangeRuntimeStartupPhase(refreshPreferredRuntime));

		// Compute once for the current document.
		refreshPreferredRuntime();

		return () => disposables.dispose();
	}, [editorService, quartoKernelManager, languageRuntimeService, documentUri]);

	// Prefer the session's runtime state. Fall back to the manager's
	// pre-session kernel state (None / Error) when no session exists.
	const runtimeStatus = runtimeState !== undefined
		? runtimeStateToRuntimeStatus[runtimeState]
		: quartoStateToRuntimeStatus[kernelState] ?? RuntimeStatus.Disconnected;
	// Label priority:
	// 1. A running session's runtime name.
	// 2. When no kernel has started, the interpreter that would start if code
	//    were run (so the badge names it instead of a bare "No Kernel").
	// 3. The state label ("No Kernel", "Kernel Error", etc.) as a fallback.
	const label = session?.runtimeMetadata.runtimeName
		?? (kernelState === QuartoKernelState.None ? preferredRuntimeName : undefined)
		?? quartoStateToLabel[kernelState]
		?? '';

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
