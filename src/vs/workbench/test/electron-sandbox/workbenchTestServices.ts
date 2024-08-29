/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { workbenchInstantiationService as browserWorkbenchInstantiationService, ITestInstantiationService, TestEncodingOracle, TestEnvironmentService, TestFileDialogService, TestFilesConfigurationService, TestFileService, TestLifecycleService, TestTextFileService } from 'vs/workbench/test/browser/workbenchTestServices';
import { ISharedProcessService } from 'vs/platform/ipc/electron-sandbox/services';
import { INativeHostService, INativeHostOptions, IOSProperties, IOSStatistics } from 'vs/platform/native/common/native';
import { VSBuffer, VSBufferReadable, VSBufferReadableStream } from 'vs/base/common/buffer';
import { DisposableStore, IDisposable } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { IFileDialogService, INativeOpenDialogOptions } from 'vs/platform/dialogs/common/dialogs';
import { IPartsSplash } from 'vs/platform/theme/common/themeService';
import { IOpenedMainWindow, IOpenEmptyWindowOptions, IWindowOpenable, IOpenWindowOptions, IColorScheme, IRectangle, IPoint } from 'vs/platform/window/common/window';
import { TestConfigurationService } from 'vs/platform/configuration/test/common/testConfigurationService';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IEnvironmentService, INativeEnvironmentService } from 'vs/platform/environment/common/environment';
import { IFileService } from 'vs/platform/files/common/files';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IPathService } from 'vs/workbench/services/path/common/pathService';
import { ITextEditorService } from 'vs/workbench/services/textfile/common/textEditorService';
import { ITextFileService } from 'vs/workbench/services/textfile/common/textfiles';
import { AbstractNativeExtensionTipsService } from 'vs/platform/extensionManagement/common/extensionTipsService';
import { IExtensionManagementService } from 'vs/platform/extensionManagement/common/extensionManagement';
import { IExtensionRecommendationNotificationService } from 'vs/platform/extensionRecommendations/common/extensionRecommendations';
import { IProductService } from 'vs/platform/product/common/productService';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IModelService } from 'vs/editor/common/services/model';
import { ModelService } from 'vs/editor/common/services/modelService';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { IFilesConfigurationService } from 'vs/workbench/services/filesConfiguration/common/filesConfigurationService';
import { ILifecycleService } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { IWorkingCopyBackupService } from 'vs/workbench/services/workingCopy/common/workingCopyBackup';
import { IWorkingCopyService } from 'vs/workbench/services/workingCopy/common/workingCopyService';
import { TestContextService } from 'vs/workbench/test/common/workbenchTestServices';
import { NativeTextFileService } from 'vs/workbench/services/textfile/electron-sandbox/nativeTextFileService';
import { insert } from 'vs/base/common/arrays';
import { Schemas } from 'vs/base/common/network';
import { FileService } from 'vs/platform/files/common/fileService';
import { InMemoryFileSystemProvider } from 'vs/platform/files/common/inMemoryFilesystemProvider';
import { NullLogService } from 'vs/platform/log/common/log';
import { FileUserDataProvider } from 'vs/platform/userData/common/fileUserDataProvider';
import { IWorkingCopyIdentifier } from 'vs/workbench/services/workingCopy/common/workingCopy';
import { NativeWorkingCopyBackupService } from 'vs/workbench/services/workingCopy/electron-sandbox/workingCopyBackupService';
import { CancellationToken } from 'vs/base/common/cancellation';
import { UriIdentityService } from 'vs/platform/uriIdentity/common/uriIdentityService';
import { UserDataProfilesService } from 'vs/platform/userDataProfile/common/userDataProfile';
import { AuthInfo, Credentials } from 'vs/platform/request/common/request';

export class TestSharedProcessService implements ISharedProcessService {

	declare readonly _serviceBrand: undefined;

	createRawConnection(): never { throw new Error('Not Implemented'); }
	getChannel(channelName: string): any { return undefined; }
	registerChannel(channelName: string, channel: any): void { }
	notifyRestored(): void { }
}

export class TestNativeHostService implements INativeHostService {
	declare readonly _serviceBrand: undefined;

	readonly windowId = -1;

	onDidOpenMainWindow: Event<number> = Event.None;
	onDidMaximizeWindow: Event<number> = Event.None;
	onDidUnmaximizeWindow: Event<number> = Event.None;
	onDidFocusMainWindow: Event<number> = Event.None;
	onDidBlurMainWindow: Event<number> = Event.None;
	onDidFocusMainOrAuxiliaryWindow: Event<number> = Event.None;
	onDidBlurMainOrAuxiliaryWindow: Event<number> = Event.None;
	onDidResumeOS: Event<unknown> = Event.None;
	onDidChangeColorScheme = Event.None;
	onDidChangePassword = Event.None;
	onDidTriggerWindowSystemContextMenu: Event<{ windowId: number; x: number; y: number }> = Event.None;
	onDidChangeWindowFullScreen = Event.None;
	onDidChangeDisplay = Event.None;

	windowCount = Promise.resolve(1);
	getWindowCount(): Promise<number> { return this.windowCount; }

	async getWindows(): Promise<IOpenedMainWindow[]> { return []; }
	async getActiveWindowId(): Promise<number | undefined> { return undefined; }

	openWindow(options?: IOpenEmptyWindowOptions): Promise<void>;
	openWindow(toOpen: IWindowOpenable[], options?: IOpenWindowOptions): Promise<void>;
	openWindow(arg1?: IOpenEmptyWindowOptions | IWindowOpenable[], arg2?: IOpenWindowOptions): Promise<void> {
		throw new Error('Method not implemented.');
	}

	async toggleFullScreen(): Promise<void> { }
	async handleTitleDoubleClick(): Promise<void> { }
	async isMaximized(): Promise<boolean> { return true; }
	async isFullScreen(): Promise<boolean> { return true; }
	async maximizeWindow(): Promise<void> { }
	async unmaximizeWindow(): Promise<void> { }
	async minimizeWindow(): Promise<void> { }
	async moveWindowTop(options?: INativeHostOptions): Promise<void> { }
	getCursorScreenPoint(): Promise<{ readonly point: IPoint; readonly display: IRectangle }> { throw new Error('Method not implemented.'); }
	async positionWindow(position: IRectangle, options?: INativeHostOptions): Promise<void> { }
	async updateWindowControls(options: { height?: number; backgroundColor?: string; foregroundColor?: string }): Promise<void> { }
	async setMinimumSize(width: number | undefined, height: number | undefined): Promise<void> { }
	async saveWindowSplash(value: IPartsSplash): Promise<void> { }
	async focusWindow(options?: INativeHostOptions): Promise<void> { }
	async showMessageBox(options: Electron.MessageBoxOptions): Promise<Electron.MessageBoxReturnValue> { throw new Error('Method not implemented.'); }
	async showSaveDialog(options: Electron.SaveDialogOptions): Promise<Electron.SaveDialogReturnValue> { throw new Error('Method not implemented.'); }
	async showOpenDialog(options: Electron.OpenDialogOptions): Promise<Electron.OpenDialogReturnValue> { throw new Error('Method not implemented.'); }
	async pickFileFolderAndOpen(options: INativeOpenDialogOptions): Promise<void> { }
	async pickFileAndOpen(options: INativeOpenDialogOptions): Promise<void> { }
	async pickFolderAndOpen(options: INativeOpenDialogOptions): Promise<void> { }
	async pickWorkspaceAndOpen(options: INativeOpenDialogOptions): Promise<void> { }
	async showItemInFolder(path: string): Promise<void> { }
	async setRepresentedFilename(path: string): Promise<void> { }
	async isAdmin(): Promise<boolean> { return false; }
	async writeElevated(source: URI, target: URI): Promise<void> { }
	async isRunningUnderARM64Translation(): Promise<boolean> { return false; }
	async getOSProperties(): Promise<IOSProperties> { return Object.create(null); }
	async getOSStatistics(): Promise<IOSStatistics> { return Object.create(null); }
	async getOSVirtualMachineHint(): Promise<number> { return 0; }
	async getOSColorScheme(): Promise<IColorScheme> { return { dark: true, highContrast: false }; }
	async hasWSLFeatureInstalled(): Promise<boolean> { return false; }
	async getProcessId(): Promise<number> { throw new Error('Method not implemented.'); }
	async killProcess(): Promise<void> { }
	async setDocumentEdited(edited: boolean): Promise<void> { }
	async openExternal(url: string, defaultApplication?: string): Promise<boolean> { return false; }
	async updateTouchBar(): Promise<void> { }
	async moveItemToTrash(): Promise<void> { }
	async newWindowTab(): Promise<void> { }
	async showPreviousWindowTab(): Promise<void> { }
	async showNextWindowTab(): Promise<void> { }
	async moveWindowTabToNewWindow(): Promise<void> { }
	async mergeAllWindowTabs(): Promise<void> { }
	async toggleWindowTabsBar(): Promise<void> { }
	async installShellCommand(): Promise<void> { }
	async uninstallShellCommand(): Promise<void> { }
	async notifyReady(): Promise<void> { }
	async relaunch(options?: { addArgs?: string[] | undefined; removeArgs?: string[] | undefined } | undefined): Promise<void> { }
	async reload(): Promise<void> { }
	async closeWindow(): Promise<void> { }
	async quit(): Promise<void> { }
	async exit(code: number): Promise<void> { }
	async openDevTools(options?: Partial<Electron.OpenDevToolsOptions> & INativeHostOptions | undefined): Promise<void> { }
	async toggleDevTools(): Promise<void> { }
	async resolveProxy(url: string): Promise<string | undefined> { return undefined; }
	async lookupAuthorization(authInfo: AuthInfo): Promise<Credentials | undefined> { return undefined; }
	async lookupKerberosAuthorization(url: string): Promise<string | undefined> { return undefined; }
	async loadCertificates(): Promise<string[]> { return []; }
	async findFreePort(startPort: number, giveUpAfter: number, timeout: number, stride?: number): Promise<number> { return -1; }
	async readClipboardText(type?: 'selection' | 'clipboard' | undefined): Promise<string> { return ''; }
	async writeClipboardText(text: string, type?: 'selection' | 'clipboard' | undefined): Promise<void> { }
	async readClipboardFindText(): Promise<string> { return ''; }
	async writeClipboardFindText(text: string): Promise<void> { }
	async writeClipboardBuffer(format: string, buffer: VSBuffer, type?: 'selection' | 'clipboard' | undefined): Promise<void> { }
	async readClipboardBuffer(format: string): Promise<VSBuffer> { return VSBuffer.wrap(Uint8Array.from([])); }
	async hasClipboard(format: string, type?: 'selection' | 'clipboard' | undefined): Promise<boolean> { return false; }
	async windowsGetStringRegKey(hive: 'HKEY_CURRENT_USER' | 'HKEY_LOCAL_MACHINE' | 'HKEY_CLASSES_ROOT' | 'HKEY_USERS' | 'HKEY_CURRENT_CONFIG', path: string, name: string): Promise<string | undefined> { return undefined; }
	async profileRenderer(): Promise<any> { throw new Error(); }

	// --- Start Positron ---
	async writeClipboardImage(dataUri: string): Promise<void> { }
	// --- End Positron ---
}

export class TestExtensionTipsService extends AbstractNativeExtensionTipsService {

	constructor(
		@INativeEnvironmentService environmentService: INativeEnvironmentService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IExtensionManagementService extensionManagementService: IExtensionManagementService,
		@IStorageService storageService: IStorageService,
		@INativeHostService nativeHostService: INativeHostService,
		@IExtensionRecommendationNotificationService extensionRecommendationNotificationService: IExtensionRecommendationNotificationService,
		@IFileService fileService: IFileService,
		@IProductService productService: IProductService,
	) {
		super(environmentService.userHome, nativeHostService, telemetryService, extensionManagementService, storageService, extensionRecommendationNotificationService, fileService, productService);
	}
}

export function workbenchInstantiationService(overrides?: {
	environmentService?: (instantiationService: IInstantiationService) => IEnvironmentService;
	fileService?: (instantiationService: IInstantiationService) => IFileService;
	configurationService?: (instantiationService: IInstantiationService) => TestConfigurationService;
	textFileService?: (instantiationService: IInstantiationService) => ITextFileService;
	pathService?: (instantiationService: IInstantiationService) => IPathService;
	editorService?: (instantiationService: IInstantiationService) => IEditorService;
	contextKeyService?: (instantiationService: IInstantiationService) => IContextKeyService;
	textEditorService?: (instantiationService: IInstantiationService) => ITextEditorService;
}, disposables = new DisposableStore()): ITestInstantiationService {
	const instantiationService = browserWorkbenchInstantiationService({
		workingCopyBackupService: () => disposables.add(new TestNativeWorkingCopyBackupService()),
		...overrides
	}, disposables);

	instantiationService.stub(INativeHostService, new TestNativeHostService());

	return instantiationService;
}

export class TestServiceAccessor {
	constructor(
		@ILifecycleService public lifecycleService: TestLifecycleService,
		@ITextFileService public textFileService: TestTextFileService,
		@IFilesConfigurationService public filesConfigurationService: TestFilesConfigurationService,
		@IWorkspaceContextService public contextService: TestContextService,
		@IModelService public modelService: ModelService,
		@IFileService public fileService: TestFileService,
		@INativeHostService public nativeHostService: TestNativeHostService,
		@IFileDialogService public fileDialogService: TestFileDialogService,
		@IWorkingCopyBackupService public workingCopyBackupService: TestNativeWorkingCopyBackupService,
		@IWorkingCopyService public workingCopyService: IWorkingCopyService,
		@IEditorService public editorService: IEditorService
	) {
	}
}

export class TestNativeTextFileServiceWithEncodingOverrides extends NativeTextFileService {

	private _testEncoding: TestEncodingOracle | undefined;
	override get encoding(): TestEncodingOracle {
		if (!this._testEncoding) {
			this._testEncoding = this._register(this.instantiationService.createInstance(TestEncodingOracle));
		}

		return this._testEncoding;
	}
}

export class TestNativeWorkingCopyBackupService extends NativeWorkingCopyBackupService implements IDisposable {

	private backupResourceJoiners: Function[];
	private discardBackupJoiners: Function[];
	discardedBackups: IWorkingCopyIdentifier[];
	discardedAllBackups: boolean;
	private pendingBackupsArr: Promise<void>[];

	constructor() {
		const environmentService = TestEnvironmentService;
		const logService = new NullLogService();
		const fileService = new FileService(logService);
		const lifecycleService = new TestLifecycleService();
		super(environmentService as any, fileService, logService, lifecycleService);

		const inMemoryFileSystemProvider = this._register(new InMemoryFileSystemProvider());
		this._register(fileService.registerProvider(Schemas.inMemory, inMemoryFileSystemProvider));
		const uriIdentityService = this._register(new UriIdentityService(fileService));
		const userDataProfilesService = this._register(new UserDataProfilesService(environmentService, fileService, uriIdentityService, logService));
		this._register(fileService.registerProvider(Schemas.vscodeUserData, this._register(new FileUserDataProvider(Schemas.file, inMemoryFileSystemProvider, Schemas.vscodeUserData, userDataProfilesService, uriIdentityService, logService))));

		this.backupResourceJoiners = [];
		this.discardBackupJoiners = [];
		this.discardedBackups = [];
		this.pendingBackupsArr = [];
		this.discardedAllBackups = false;

		this._register(fileService);
		this._register(lifecycleService);
	}

	testGetFileService(): IFileService {
		return this.fileService;
	}

	async waitForAllBackups(): Promise<void> {
		await Promise.all(this.pendingBackupsArr);
	}

	joinBackupResource(): Promise<void> {
		return new Promise(resolve => this.backupResourceJoiners.push(resolve));
	}

	override async backup(identifier: IWorkingCopyIdentifier, content?: VSBufferReadableStream | VSBufferReadable, versionId?: number, meta?: any, token?: CancellationToken): Promise<void> {
		const p = super.backup(identifier, content, versionId, meta, token);
		const removeFromPendingBackups = insert(this.pendingBackupsArr, p.then(undefined, undefined));

		try {
			await p;
		} finally {
			removeFromPendingBackups();
		}

		while (this.backupResourceJoiners.length) {
			this.backupResourceJoiners.pop()!();
		}
	}

	joinDiscardBackup(): Promise<void> {
		return new Promise(resolve => this.discardBackupJoiners.push(resolve));
	}

	override async discardBackup(identifier: IWorkingCopyIdentifier): Promise<void> {
		await super.discardBackup(identifier);
		this.discardedBackups.push(identifier);

		while (this.discardBackupJoiners.length) {
			this.discardBackupJoiners.pop()!();
		}
	}

	override async discardBackups(filter?: { except: IWorkingCopyIdentifier[] }): Promise<void> {
		this.discardedAllBackups = true;

		return super.discardBackups(filter);
	}

	async getBackupContents(identifier: IWorkingCopyIdentifier): Promise<string> {
		const backupResource = this.toBackupResource(identifier);

		const fileContents = await this.fileService.readFile(backupResource);

		return fileContents.value.toString();
	}
}
