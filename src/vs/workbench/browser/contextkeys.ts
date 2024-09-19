/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { IContextKeyService, IContextKey, setConstant as setConstantContextKey } from 'vs/platform/contextkey/common/contextkey';
import { InputFocusedContext, IsMacContext, IsLinuxContext, IsWindowsContext, IsWebContext, IsMacNativeContext, IsDevelopmentContext, IsIOSContext, ProductQualityContext, IsMobileContext } from 'vs/platform/contextkey/common/contextkeys';
// --- Start PWB: disable file downloads ---
// eslint-disable-next-line no-duplicate-imports
import { IsEnabledFileDownloads, IsEnabledFileUploads } from 'vs/workbench/common/contextkeys';
// --- End PWB ---
import { SplitEditorsVertically, InEditorZenModeContext, AuxiliaryBarVisibleContext, SideBarVisibleContext, PanelAlignmentContext, PanelMaximizedContext, PanelVisibleContext, EmbedderIdentifierContext, EditorTabsVisibleContext, IsMainEditorCenteredLayoutContext, MainEditorAreaVisibleContext, DirtyWorkingCopiesContext, EmptyWorkspaceSupportContext, EnterMultiRootWorkspaceSupportContext, HasWebFileSystemAccess, IsMainWindowFullscreenContext, OpenFolderWorkspaceSupportContext, RemoteNameContext, VirtualWorkspaceContext, WorkbenchStateContext, WorkspaceFolderCountContext, PanelPositionContext, TemporaryWorkspaceContext, TitleBarVisibleContext, TitleBarStyleContext, IsAuxiliaryWindowFocusedContext, ActiveEditorGroupEmptyContext, ActiveEditorGroupIndexContext, ActiveEditorGroupLastContext, ActiveEditorGroupLockedContext, MultipleEditorGroupsContext, EditorsVisibleContext } from 'vs/workbench/common/contextkeys';
import { trackFocus, addDisposableListener, EventType, onDidRegisterWindow, getActiveWindow } from 'vs/base/browser/dom';
import { preferredSideBySideGroupDirection, GroupDirection, IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
// --- Start PWB: disable file downloads ---
import { IBrowserWorkbenchEnvironmentService } from 'vs/workbench/services/environment/browser/environmentService';
// --- End PWB ---
import { WorkbenchState, IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { IWorkbenchLayoutService, Parts, positionToString } from 'vs/workbench/services/layout/browser/layoutService';
import { getRemoteName } from 'vs/platform/remote/common/remoteHosts';
import { getVirtualWorkspaceScheme } from 'vs/platform/workspace/common/virtualWorkspace';
import { IWorkingCopyService } from 'vs/workbench/services/workingCopy/common/workingCopyService';
import { isNative } from 'vs/base/common/platform';
import { IPaneCompositePartService } from 'vs/workbench/services/panecomposite/browser/panecomposite';
import { WebFileSystemAccess } from 'vs/platform/files/browser/webFileSystemAccess';
import { IProductService } from 'vs/platform/product/common/productService';
import { getTitleBarStyle } from 'vs/platform/window/common/window';
import { mainWindow } from 'vs/base/browser/window';
import { isFullscreen, onDidChangeFullscreen } from 'vs/base/browser/browser';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';

// --- Start Positron ---
// eslint-disable-next-line no-duplicate-imports
import { PositronTopActionBarVisibleContext } from 'vs/workbench/common/contextkeys';
// eslint-disable-next-line no-duplicate-imports
import { isTemporaryWorkspace } from 'vs/platform/workspace/common/workspace';
// --- End Positron ---

export class WorkbenchContextKeysHandler extends Disposable {
	private inputFocusedContext: IContextKey<boolean>;

	private dirtyWorkingCopiesContext: IContextKey<boolean>;

	private activeEditorGroupEmpty: IContextKey<boolean>;
	private activeEditorGroupIndex: IContextKey<number>;
	private activeEditorGroupLast: IContextKey<boolean>;
	private activeEditorGroupLocked: IContextKey<boolean>;
	private multipleEditorGroupsContext: IContextKey<boolean>;

	private editorsVisibleContext: IContextKey<boolean>;

	private splitEditorsVerticallyContext: IContextKey<boolean>;

	private workbenchStateContext: IContextKey<string>;
	private workspaceFolderCountContext: IContextKey<number>;

	private openFolderWorkspaceSupportContext: IContextKey<boolean>;
	private enterMultiRootWorkspaceSupportContext: IContextKey<boolean>;
	private emptyWorkspaceSupportContext: IContextKey<boolean>;

	private virtualWorkspaceContext: IContextKey<string>;
	// --- Start Positron ---
	private temporaryWorkspaceContext: IContextKey<boolean>;
	// --- End Positron ---

	private inZenModeContext: IContextKey<boolean>;
	private isMainWindowFullscreenContext: IContextKey<boolean>;
	private isAuxiliaryWindowFocusedContext: IContextKey<boolean>;
	private isMainEditorCenteredLayoutContext: IContextKey<boolean>;
	private sideBarVisibleContext: IContextKey<boolean>;
	private mainEditorAreaVisibleContext: IContextKey<boolean>;
	private panelPositionContext: IContextKey<string>;
	private panelVisibleContext: IContextKey<boolean>;
	private panelAlignmentContext: IContextKey<string>;
	private panelMaximizedContext: IContextKey<boolean>;
	private auxiliaryBarVisibleContext: IContextKey<boolean>;
	private editorTabsVisibleContext: IContextKey<boolean>;
	private titleAreaVisibleContext: IContextKey<boolean>;
	private titleBarStyleContext: IContextKey<string>;

	// --- Start Positron ---
	private positronTopActionBarVisibleContext: IContextKey<boolean>;
	// --- End Positron ---

	constructor(
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		// --- Start PWB: disable file downloads ---
		@IBrowserWorkbenchEnvironmentService private readonly environmentService: IBrowserWorkbenchEnvironmentService,
		// --- End PWB ---
		@IProductService private readonly productService: IProductService,
		@IEditorGroupsService private readonly editorGroupService: IEditorGroupsService,
		@IEditorService private readonly editorService: IEditorService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IPaneCompositePartService private readonly paneCompositeService: IPaneCompositePartService,
		@IWorkingCopyService private readonly workingCopyService: IWorkingCopyService,
	) {
		super();

		// Platform
		IsMacContext.bindTo(this.contextKeyService);
		IsLinuxContext.bindTo(this.contextKeyService);
		IsWindowsContext.bindTo(this.contextKeyService);

		IsWebContext.bindTo(this.contextKeyService);
		IsMacNativeContext.bindTo(this.contextKeyService);
		IsIOSContext.bindTo(this.contextKeyService);
		IsMobileContext.bindTo(this.contextKeyService);

		RemoteNameContext.bindTo(this.contextKeyService).set(getRemoteName(this.environmentService.remoteAuthority) || '');

		this.virtualWorkspaceContext = VirtualWorkspaceContext.bindTo(this.contextKeyService);
		// --- Start Positron ---
		this.temporaryWorkspaceContext = TemporaryWorkspaceContext.bindTo(this.contextKeyService);
		// --- End Positron ---
		this.updateWorkspaceContextKeys();

		// Capabilities
		HasWebFileSystemAccess.bindTo(this.contextKeyService).set(WebFileSystemAccess.supported(mainWindow));

		// Development
		const isDevelopment = !this.environmentService.isBuilt || this.environmentService.isExtensionDevelopment;
		IsDevelopmentContext.bindTo(this.contextKeyService).set(isDevelopment);
		setConstantContextKey(IsDevelopmentContext.key, isDevelopment);

		// Product Service
		ProductQualityContext.bindTo(this.contextKeyService).set(this.productService.quality || '');
		EmbedderIdentifierContext.bindTo(this.contextKeyService).set(productService.embedderIdentifier);

		// Editor Groups
		this.activeEditorGroupEmpty = ActiveEditorGroupEmptyContext.bindTo(this.contextKeyService);
		this.activeEditorGroupIndex = ActiveEditorGroupIndexContext.bindTo(this.contextKeyService);
		this.activeEditorGroupLast = ActiveEditorGroupLastContext.bindTo(this.contextKeyService);
		this.activeEditorGroupLocked = ActiveEditorGroupLockedContext.bindTo(this.contextKeyService);
		this.multipleEditorGroupsContext = MultipleEditorGroupsContext.bindTo(this.contextKeyService);

		// Editors
		this.editorsVisibleContext = EditorsVisibleContext.bindTo(this.contextKeyService);

		// Working Copies
		this.dirtyWorkingCopiesContext = DirtyWorkingCopiesContext.bindTo(this.contextKeyService);
		this.dirtyWorkingCopiesContext.set(this.workingCopyService.hasDirty);

		// Inputs
		this.inputFocusedContext = InputFocusedContext.bindTo(this.contextKeyService);

		// Workbench State
		this.workbenchStateContext = WorkbenchStateContext.bindTo(this.contextKeyService);
		this.updateWorkbenchStateContextKey();

		// Workspace Folder Count
		this.workspaceFolderCountContext = WorkspaceFolderCountContext.bindTo(this.contextKeyService);
		this.updateWorkspaceFolderCountContextKey();

		// Opening folder support: support for opening a folder workspace
		// (e.g. "Open Folder...") is limited in web when not connected
		// to a remote.
		this.openFolderWorkspaceSupportContext = OpenFolderWorkspaceSupportContext.bindTo(this.contextKeyService);
		this.openFolderWorkspaceSupportContext.set(isNative || typeof this.environmentService.remoteAuthority === 'string');

		// Empty workspace support: empty workspaces require built-in file system
		// providers to be available that allow to enter a workspace or open loose
		// files. This condition is met:
		// - desktop: always
		// -     web: only when connected to a remote
		this.emptyWorkspaceSupportContext = EmptyWorkspaceSupportContext.bindTo(this.contextKeyService);
		this.emptyWorkspaceSupportContext.set(isNative || typeof this.environmentService.remoteAuthority === 'string');

		// Entering a multi root workspace support: support for entering a multi-root
		// workspace (e.g. "Open Workspace from File...", "Duplicate Workspace", "Save Workspace")
		// is driven by the ability to resolve a workspace configuration file (*.code-workspace)
		// with a built-in file system provider.
		// This condition is met:
		// - desktop: always
		// -     web: only when connected to a remote
		this.enterMultiRootWorkspaceSupportContext = EnterMultiRootWorkspaceSupportContext.bindTo(this.contextKeyService);
		this.enterMultiRootWorkspaceSupportContext.set(isNative || typeof this.environmentService.remoteAuthority === 'string');

		// Editor Layout
		this.splitEditorsVerticallyContext = SplitEditorsVertically.bindTo(this.contextKeyService);
		this.updateSplitEditorsVerticallyContext();

		// Window
		this.isMainWindowFullscreenContext = IsMainWindowFullscreenContext.bindTo(this.contextKeyService);
		this.isAuxiliaryWindowFocusedContext = IsAuxiliaryWindowFocusedContext.bindTo(this.contextKeyService);

		// Zen Mode
		this.inZenModeContext = InEditorZenModeContext.bindTo(this.contextKeyService);

		// Centered Layout (Main Editor)
		this.isMainEditorCenteredLayoutContext = IsMainEditorCenteredLayoutContext.bindTo(this.contextKeyService);

		// Editor Area
		this.mainEditorAreaVisibleContext = MainEditorAreaVisibleContext.bindTo(this.contextKeyService);
		this.editorTabsVisibleContext = EditorTabsVisibleContext.bindTo(this.contextKeyService);

		// Sidebar
		this.sideBarVisibleContext = SideBarVisibleContext.bindTo(this.contextKeyService);

		// Title Bar
		this.titleAreaVisibleContext = TitleBarVisibleContext.bindTo(this.contextKeyService);
		this.titleBarStyleContext = TitleBarStyleContext.bindTo(this.contextKeyService);
		this.updateTitleBarContextKeys();

		// Panel
		this.panelPositionContext = PanelPositionContext.bindTo(this.contextKeyService);
		this.panelPositionContext.set(positionToString(this.layoutService.getPanelPosition()));
		this.panelVisibleContext = PanelVisibleContext.bindTo(this.contextKeyService);
		this.panelVisibleContext.set(this.layoutService.isVisible(Parts.PANEL_PART));
		this.panelMaximizedContext = PanelMaximizedContext.bindTo(this.contextKeyService);
		this.panelMaximizedContext.set(this.layoutService.isPanelMaximized());
		this.panelAlignmentContext = PanelAlignmentContext.bindTo(this.contextKeyService);
		this.panelAlignmentContext.set(this.layoutService.getPanelAlignment());

		// --- Start Positron ---
		// Positron Top Action Bar
		this.positronTopActionBarVisibleContext = PositronTopActionBarVisibleContext.bindTo(this.contextKeyService);
		this.positronTopActionBarVisibleContext.set(this.layoutService.isVisible(Parts.POSITRON_TOP_ACTION_BAR_PART));
		// --- End Positron ---

		// Auxiliary Bar
		this.auxiliaryBarVisibleContext = AuxiliaryBarVisibleContext.bindTo(this.contextKeyService);
		this.auxiliaryBarVisibleContext.set(this.layoutService.isVisible(Parts.AUXILIARYBAR_PART));

		// --- Start PWB: disable file downloads ---
		IsEnabledFileDownloads.bindTo(this.contextKeyService).set(this.environmentService.isEnabledFileDownloads ?? true);
		IsEnabledFileUploads.bindTo(this.contextKeyService).set(this.environmentService.isEnabledFileUploads ?? true);
		// --- End PWB ---

		this.registerListeners();
	}

	private registerListeners(): void {
		this.editorGroupService.whenReady.then(() => {
			this.updateEditorAreaContextKeys();
			this.updateActiveEditorGroupContextKeys();
			this.updateVisiblePanesContextKeys();
		});

		this._register(this.editorService.onDidActiveEditorChange(() => this.updateActiveEditorGroupContextKeys()));
		this._register(this.editorService.onDidVisibleEditorsChange(() => this.updateVisiblePanesContextKeys()));
		this._register(this.editorGroupService.onDidAddGroup(() => this.updateEditorGroupsContextKeys()));
		this._register(this.editorGroupService.onDidRemoveGroup(() => this.updateEditorGroupsContextKeys()));
		this._register(this.editorGroupService.onDidChangeGroupIndex(() => this.updateActiveEditorGroupContextKeys()));
		this._register(this.editorGroupService.onDidChangeGroupLocked(() => this.updateActiveEditorGroupContextKeys()));

		this._register(this.editorGroupService.onDidChangeEditorPartOptions(() => this.updateEditorAreaContextKeys()));

		this._register(Event.runAndSubscribe(onDidRegisterWindow, ({ window, disposables }) => disposables.add(addDisposableListener(window, EventType.FOCUS_IN, () => this.updateInputContextKeys(window.document), true)), { window: mainWindow, disposables: this._store }));

		this._register(this.contextService.onDidChangeWorkbenchState(() => this.updateWorkbenchStateContextKey()));
		this._register(this.contextService.onDidChangeWorkspaceFolders(() => {
			this.updateWorkspaceFolderCountContextKey();
			this.updateWorkspaceContextKeys();
		}));

		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('workbench.editor.openSideBySideDirection')) {
				this.updateSplitEditorsVerticallyContext();
			}
		}));

		this._register(this.layoutService.onDidChangeZenMode(enabled => this.inZenModeContext.set(enabled)));
		this._register(this.layoutService.onDidChangeActiveContainer(() => this.isAuxiliaryWindowFocusedContext.set(this.layoutService.activeContainer !== this.layoutService.mainContainer)));
		this._register(onDidChangeFullscreen(windowId => {
			if (windowId === mainWindow.vscodeWindowId) {
				this.isMainWindowFullscreenContext.set(isFullscreen(mainWindow));
			}
		}));
		this._register(this.layoutService.onDidChangeMainEditorCenteredLayout(centered => this.isMainEditorCenteredLayoutContext.set(centered)));
		this._register(this.layoutService.onDidChangePanelPosition(position => this.panelPositionContext.set(position)));

		this._register(this.layoutService.onDidChangePanelAlignment(alignment => this.panelAlignmentContext.set(alignment)));

		this._register(this.paneCompositeService.onDidPaneCompositeClose(() => this.updateSideBarContextKeys()));
		this._register(this.paneCompositeService.onDidPaneCompositeOpen(() => this.updateSideBarContextKeys()));

		this._register(this.layoutService.onDidChangePartVisibility(() => {
			this.mainEditorAreaVisibleContext.set(this.layoutService.isVisible(Parts.EDITOR_PART, mainWindow));
			this.panelVisibleContext.set(this.layoutService.isVisible(Parts.PANEL_PART));
			this.panelMaximizedContext.set(this.layoutService.isPanelMaximized());
			this.auxiliaryBarVisibleContext.set(this.layoutService.isVisible(Parts.AUXILIARYBAR_PART));
			this.updateTitleBarContextKeys();

			// --- Start Positron ---
			this.positronTopActionBarVisibleContext.set(this.layoutService.isVisible(Parts.POSITRON_TOP_ACTION_BAR_PART));
			// --- End Positron ---
		}));

		this._register(this.workingCopyService.onDidChangeDirty(workingCopy => this.dirtyWorkingCopiesContext.set(workingCopy.isDirty() || this.workingCopyService.hasDirty)));
	}

	private updateVisiblePanesContextKeys(): void {
		const visibleEditorPanes = this.editorService.visibleEditorPanes;
		if (visibleEditorPanes.length > 0) {
			this.editorsVisibleContext.set(true);
		} else {
			this.editorsVisibleContext.reset();
		}
	}

	// Context keys depending on the state of the editor group itself
	private updateActiveEditorGroupContextKeys(): void {
		if (!this.editorService.activeEditor) {
			this.activeEditorGroupEmpty.set(true);
		} else {
			this.activeEditorGroupEmpty.reset();
		}

		const activeGroup = this.editorGroupService.activeGroup;
		this.activeEditorGroupIndex.set(activeGroup.index + 1); // not zero-indexed
		this.activeEditorGroupLocked.set(activeGroup.isLocked);

		this.updateEditorGroupsContextKeys();
	}

	// Context keys depending on the state of other editor groups
	private updateEditorGroupsContextKeys(): void {
		const groupCount = this.editorGroupService.count;
		if (groupCount > 1) {
			this.multipleEditorGroupsContext.set(true);
		} else {
			this.multipleEditorGroupsContext.reset();
		}

		const activeGroup = this.editorGroupService.activeGroup;
		this.activeEditorGroupLast.set(activeGroup.index === groupCount - 1);
	}

	private updateEditorAreaContextKeys(): void {
		this.editorTabsVisibleContext.set(this.editorGroupService.partOptions.showTabs === 'multiple');
	}

	private updateInputContextKeys(ownerDocument: Document): void {

		function activeElementIsInput(): boolean {
			return !!ownerDocument.activeElement && (ownerDocument.activeElement.tagName === 'INPUT' || ownerDocument.activeElement.tagName === 'TEXTAREA');
		}

		const isInputFocused = activeElementIsInput();
		this.inputFocusedContext.set(isInputFocused);

		if (isInputFocused) {
			const tracker = trackFocus(ownerDocument.activeElement as HTMLElement);
			Event.once(tracker.onDidBlur)(() => {

				// Ensure we are only updating the context key if we are
				// still in the same document that we are tracking. This
				// fixes a race condition in multi-window setups where
				// the blur event arrives in the inactive window overwriting
				// the context key of the active window. This is because
				// blur events from the focus tracker are emitted with a
				// timeout of 0.

				if (getActiveWindow().document === ownerDocument) {
					this.inputFocusedContext.set(activeElementIsInput());
				}

				tracker.dispose();
			});
		}
	}

	private updateWorkbenchStateContextKey(): void {
		this.workbenchStateContext.set(this.getWorkbenchStateString());
	}

	private updateWorkspaceFolderCountContextKey(): void {
		this.workspaceFolderCountContext.set(this.contextService.getWorkspace().folders.length);
	}

	private updateSplitEditorsVerticallyContext(): void {
		const direction = preferredSideBySideGroupDirection(this.configurationService);
		this.splitEditorsVerticallyContext.set(direction === GroupDirection.DOWN);
	}

	private getWorkbenchStateString(): string {
		switch (this.contextService.getWorkbenchState()) {
			case WorkbenchState.EMPTY: return 'empty';
			case WorkbenchState.FOLDER: return 'folder';
			case WorkbenchState.WORKSPACE: return 'workspace';
		}
	}

	private updateSideBarContextKeys(): void {
		this.sideBarVisibleContext.set(this.layoutService.isVisible(Parts.SIDEBAR_PART));
	}

	private updateTitleBarContextKeys(): void {
		this.titleAreaVisibleContext.set(this.layoutService.isVisible(Parts.TITLEBAR_PART, mainWindow));
		this.titleBarStyleContext.set(getTitleBarStyle(this.configurationService));
	}

	private updateWorkspaceContextKeys(): void {
		this.virtualWorkspaceContext.set(getVirtualWorkspaceScheme(this.contextService.getWorkspace()) || '');
		// --- Start Positron ---
		this.temporaryWorkspaceContext.set(isTemporaryWorkspace(this.contextService.getWorkspace()));
		// --- End Positron ---
	}
}
