/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import { Promises, Queue } from 'vs/base/common/async';
import { VSBuffer } from 'vs/base/common/buffer';
import { CancellationToken } from 'vs/base/common/cancellation';
import { IStringDictionary } from 'vs/base/common/collections';
import { toErrorMessage } from 'vs/base/common/errorMessage';
import { CancellationError, getErrorMessage } from 'vs/base/common/errors';
import { Emitter } from 'vs/base/common/event';
import { hash } from 'vs/base/common/hash';
import { Disposable } from 'vs/base/common/lifecycle';
import { ResourceMap, ResourceSet } from 'vs/base/common/map';
import { Schemas } from 'vs/base/common/network';
import * as path from 'vs/base/common/path';
import { joinPath } from 'vs/base/common/resources';
import * as semver from 'vs/base/common/semver/semver';
import { isBoolean } from 'vs/base/common/types';
import { URI } from 'vs/base/common/uri';
import { generateUuid } from 'vs/base/common/uuid';
import * as pfs from 'vs/base/node/pfs';
import { extract, IFile, zip } from 'vs/base/node/zip';
import * as nls from 'vs/nls';
import { IDownloadService } from 'vs/platform/download/common/download';
import { INativeEnvironmentService } from 'vs/platform/environment/common/environment';
import { AbstractExtensionManagementService, AbstractExtensionTask, ExtensionVerificationStatus, IInstallExtensionTask, InstallExtensionTaskOptions, IUninstallExtensionTask, toExtensionManagementError, UninstallExtensionTaskOptions } from 'vs/platform/extensionManagement/common/abstractExtensionManagementService';
import {
	ExtensionManagementError, ExtensionManagementErrorCode, IExtensionGalleryService, IExtensionIdentifier, IExtensionManagementService, IGalleryExtension, ILocalExtension, InstallOperation,
	Metadata, InstallOptions,
	IProductVersion,
	EXTENSION_INSTALL_CLIENT_TARGET_PLATFORM_CONTEXT,
} from 'vs/platform/extensionManagement/common/extensionManagement';
import { areSameExtensions, computeTargetPlatform, ExtensionKey, getGalleryExtensionId, groupByExtension } from 'vs/platform/extensionManagement/common/extensionManagementUtil';
import { IExtensionsProfileScannerService, IScannedProfileExtension } from 'vs/platform/extensionManagement/common/extensionsProfileScannerService';
import { IExtensionsScannerService, IScannedExtension, ScanOptions } from 'vs/platform/extensionManagement/common/extensionsScannerService';
import { ExtensionsDownloader } from 'vs/platform/extensionManagement/node/extensionDownloader';
import { ExtensionsLifecycle } from 'vs/platform/extensionManagement/node/extensionLifecycle';
import { fromExtractError, getManifest } from 'vs/platform/extensionManagement/node/extensionManagementUtil';
import { ExtensionsManifestCache } from 'vs/platform/extensionManagement/node/extensionsManifestCache';
import { DidChangeProfileExtensionsEvent, ExtensionsWatcher } from 'vs/platform/extensionManagement/node/extensionsWatcher';
import { ExtensionType, IExtension, IExtensionManifest, TargetPlatform } from 'vs/platform/extensions/common/extensions';
import { isEngineValid } from 'vs/platform/extensions/common/extensionValidator';
import { FileChangesEvent, FileChangeType, FileOperationResult, IFileService, toFileOperationResult } from 'vs/platform/files/common/files';
import { IInstantiationService, refineServiceDecorator } from 'vs/platform/instantiation/common/instantiation';
import { ILogService } from 'vs/platform/log/common/log';
import { IProductService } from 'vs/platform/product/common/productService';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IUriIdentityService } from 'vs/platform/uriIdentity/common/uriIdentity';
import { IUserDataProfilesService } from 'vs/platform/userDataProfile/common/userDataProfile';

export const INativeServerExtensionManagementService = refineServiceDecorator<IExtensionManagementService, INativeServerExtensionManagementService>(IExtensionManagementService);
export interface INativeServerExtensionManagementService extends IExtensionManagementService {
	readonly _serviceBrand: undefined;
	scanAllUserInstalledExtensions(): Promise<ILocalExtension[]>;
	scanInstalledExtensionAtLocation(location: URI): Promise<ILocalExtension | null>;
	markAsUninstalled(...extensions: IExtension[]): Promise<void>;
}

type ExtractExtensionResult = { readonly local: ILocalExtension; readonly verificationStatus?: ExtensionVerificationStatus };

const DELETED_FOLDER_POSTFIX = '.vsctmp';

export class ExtensionManagementService extends AbstractExtensionManagementService implements INativeServerExtensionManagementService {

	private readonly extensionsScanner: ExtensionsScanner;
	private readonly manifestCache: ExtensionsManifestCache;
	private readonly extensionsDownloader: ExtensionsDownloader;

	private readonly extractingGalleryExtensions = new Map<string, Promise<ExtractExtensionResult>>();

	constructor(
		@IExtensionGalleryService galleryService: IExtensionGalleryService,
		@ITelemetryService telemetryService: ITelemetryService,
		@ILogService logService: ILogService,
		@INativeEnvironmentService environmentService: INativeEnvironmentService,
		@IExtensionsScannerService private readonly extensionsScannerService: IExtensionsScannerService,
		@IExtensionsProfileScannerService private readonly extensionsProfileScannerService: IExtensionsProfileScannerService,
		@IDownloadService private downloadService: IDownloadService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IFileService private readonly fileService: IFileService,
		@IProductService productService: IProductService,
		@IUriIdentityService uriIdentityService: IUriIdentityService,
		@IUserDataProfilesService userDataProfilesService: IUserDataProfilesService
	) {
		super(galleryService, telemetryService, uriIdentityService, logService, productService, userDataProfilesService);
		const extensionLifecycle = this._register(instantiationService.createInstance(ExtensionsLifecycle));
		this.extensionsScanner = this._register(instantiationService.createInstance(ExtensionsScanner, extension => extensionLifecycle.postUninstall(extension)));
		this.manifestCache = this._register(new ExtensionsManifestCache(userDataProfilesService, fileService, uriIdentityService, this, this.logService));
		this.extensionsDownloader = this._register(instantiationService.createInstance(ExtensionsDownloader));

		const extensionsWatcher = this._register(new ExtensionsWatcher(this, this.extensionsScannerService, userDataProfilesService, extensionsProfileScannerService, uriIdentityService, fileService, logService));
		this._register(extensionsWatcher.onDidChangeExtensionsByAnotherSource(e => this.onDidChangeExtensionsFromAnotherSource(e)));
		this.watchForExtensionsNotInstalledBySystem();
	}

	private _targetPlatformPromise: Promise<TargetPlatform> | undefined;
	getTargetPlatform(): Promise<TargetPlatform> {
		if (!this._targetPlatformPromise) {
			this._targetPlatformPromise = computeTargetPlatform(this.fileService, this.logService);
		}
		return this._targetPlatformPromise;
	}

	async zip(extension: ILocalExtension): Promise<URI> {
		this.logService.trace('ExtensionManagementService#zip', extension.identifier.id);
		const files = await this.collectFiles(extension);
		const location = await zip(joinPath(this.extensionsDownloader.extensionsDownloadDir, generateUuid()).fsPath, files);
		return URI.file(location);
	}

	async getManifest(vsix: URI): Promise<IExtensionManifest> {
		const { location, cleanup } = await this.downloadVsix(vsix);
		const zipPath = path.resolve(location.fsPath);
		try {
			return await getManifest(zipPath);
		} finally {
			await cleanup();
		}
	}

	getInstalled(type?: ExtensionType, profileLocation: URI = this.userDataProfilesService.defaultProfile.extensionsResource, productVersion: IProductVersion = { version: this.productService.version, date: this.productService.date }): Promise<ILocalExtension[]> {
		return this.extensionsScanner.scanExtensions(type ?? null, profileLocation, productVersion);
	}

	scanAllUserInstalledExtensions(): Promise<ILocalExtension[]> {
		return this.extensionsScanner.scanAllUserExtensions(false);
	}

	scanInstalledExtensionAtLocation(location: URI): Promise<ILocalExtension | null> {
		return this.extensionsScanner.scanUserExtensionAtLocation(location);
	}

	async install(vsix: URI, options: InstallOptions = {}): Promise<ILocalExtension> {
		this.logService.trace('ExtensionManagementService#install', vsix.toString());

		const { location, cleanup } = await this.downloadVsix(vsix);

		try {
			const manifest = await getManifest(path.resolve(location.fsPath));
			const extensionId = getGalleryExtensionId(manifest.publisher, manifest.name);
			if (manifest.engines && manifest.engines.vscode && !isEngineValid(manifest.engines.vscode, this.productService.version, this.productService.date)) {
				throw new Error(nls.localize('incompatible', "Unable to install extension '{0}' as it is not compatible with VS Code '{1}'.", extensionId, this.productService.version));
			}

			const results = await this.installExtensions([{ manifest, extension: location, options }]);
			const result = results.find(({ identifier }) => areSameExtensions(identifier, { id: extensionId }));
			if (result?.local) {
				return result.local;
			}
			if (result?.error) {
				throw result.error;
			}
			throw toExtensionManagementError(new Error(`Unknown error while installing extension ${extensionId}`));
		} finally {
			await cleanup();
		}
	}

	async installFromLocation(location: URI, profileLocation: URI): Promise<ILocalExtension> {
		this.logService.trace('ExtensionManagementService#installFromLocation', location.toString());
		const local = await this.extensionsScanner.scanUserExtensionAtLocation(location);
		if (!local || !local.manifest.name || !local.manifest.version) {
			throw new Error(`Cannot find a valid extension from the location ${location.toString()}`);
		}
		await this.addExtensionsToProfile([[local, { source: 'resource' }]], profileLocation);
		this.logService.info('Successfully installed extension', local.identifier.id, profileLocation.toString());
		return local;
	}

	async installExtensionsFromProfile(extensions: IExtensionIdentifier[], fromProfileLocation: URI, toProfileLocation: URI): Promise<ILocalExtension[]> {
		this.logService.trace('ExtensionManagementService#installExtensionsFromProfile', extensions, fromProfileLocation.toString(), toProfileLocation.toString());
		const extensionsToInstall = (await this.getInstalled(ExtensionType.User, fromProfileLocation)).filter(e => extensions.some(id => areSameExtensions(id, e.identifier)));
		if (extensionsToInstall.length) {
			const metadata = await Promise.all(extensionsToInstall.map(e => this.extensionsScanner.scanMetadata(e, fromProfileLocation)));
			await this.addExtensionsToProfile(extensionsToInstall.map((e, index) => [e, metadata[index]]), toProfileLocation);
			this.logService.info('Successfully installed extensions', extensionsToInstall.map(e => e.identifier.id), toProfileLocation.toString());
		}
		return extensionsToInstall;
	}

	async updateMetadata(local: ILocalExtension, metadata: Partial<Metadata>, profileLocation: URI): Promise<ILocalExtension> {
		this.logService.trace('ExtensionManagementService#updateMetadata', local.identifier.id);
		if (metadata.isPreReleaseVersion) {
			metadata.preRelease = true;
			metadata.hasPreReleaseVersion = true;
		}
		// unset if false
		if (metadata.isMachineScoped === false) {
			metadata.isMachineScoped = undefined;
		}
		if (metadata.isBuiltin === false) {
			metadata.isBuiltin = undefined;
		}
		if (metadata.pinned === false) {
			metadata.pinned = undefined;
		}
		local = await this.extensionsScanner.updateMetadata(local, metadata, profileLocation);
		this.manifestCache.invalidate(profileLocation);
		this._onDidUpdateExtensionMetadata.fire({ local, profileLocation });
		return local;
	}

	async reinstallFromGallery(extension: ILocalExtension): Promise<ILocalExtension> {
		this.logService.trace('ExtensionManagementService#reinstallFromGallery', extension.identifier.id);
		if (!this.galleryService.isEnabled()) {
			throw new Error(nls.localize('MarketPlaceDisabled', "Marketplace is not enabled"));
		}

		const targetPlatform = await this.getTargetPlatform();
		const [galleryExtension] = await this.galleryService.getExtensions([{ ...extension.identifier, preRelease: extension.preRelease }], { targetPlatform, compatible: true }, CancellationToken.None);
		if (!galleryExtension) {
			throw new Error(nls.localize('Not a Marketplace extension', "Only Marketplace Extensions can be reinstalled"));
		}

		await this.extensionsScanner.setUninstalled(extension);
		try {
			await this.extensionsScanner.removeUninstalledExtension(extension);
		} catch (e) {
			throw new Error(nls.localize('removeError', "Error while removing the extension: {0}. Please Quit and Start VS Code before trying again.", toErrorMessage(e)));
		}
		return this.installFromGallery(galleryExtension);
	}

	protected copyExtension(extension: ILocalExtension, fromProfileLocation: URI, toProfileLocation: URI, metadata: Partial<Metadata>): Promise<ILocalExtension> {
		return this.extensionsScanner.copyExtension(extension, fromProfileLocation, toProfileLocation, metadata);
	}

	copyExtensions(fromProfileLocation: URI, toProfileLocation: URI): Promise<void> {
		return this.extensionsScanner.copyExtensions(fromProfileLocation, toProfileLocation, { version: this.productService.version, date: this.productService.date });
	}

	markAsUninstalled(...extensions: IExtension[]): Promise<void> {
		return this.extensionsScanner.setUninstalled(...extensions);
	}

	async cleanUp(): Promise<void> {
		this.logService.trace('ExtensionManagementService#cleanUp');
		try {
			await this.extensionsScanner.cleanUp();
		} catch (error) {
			this.logService.error(error);
		}
	}

	async download(extension: IGalleryExtension, operation: InstallOperation, donotVerifySignature: boolean): Promise<URI> {
		const { location } = await this.extensionsDownloader.download(extension, operation, !donotVerifySignature);
		return location;
	}

	private async downloadVsix(vsix: URI): Promise<{ location: URI; cleanup: () => Promise<void> }> {
		if (vsix.scheme === Schemas.file) {
			return { location: vsix, async cleanup() { } };
		}
		this.logService.trace('Downloading extension from', vsix.toString());
		const location = joinPath(this.extensionsDownloader.extensionsDownloadDir, generateUuid());
		await this.downloadService.download(vsix, location);
		this.logService.info('Downloaded extension to', location.toString());
		const cleanup = async () => {
			try {
				await this.fileService.del(location);
			} catch (error) {
				this.logService.error(error);
			}
		};
		return { location, cleanup };
	}

	protected getCurrentExtensionsManifestLocation(): URI {
		return this.userDataProfilesService.defaultProfile.extensionsResource;
	}

	protected createInstallExtensionTask(manifest: IExtensionManifest, extension: URI | IGalleryExtension, options: InstallExtensionTaskOptions): IInstallExtensionTask {
		const extensionKey = extension instanceof URI ? new ExtensionKey({ id: getGalleryExtensionId(manifest.publisher, manifest.name) }, manifest.version) : ExtensionKey.create(extension);
		return this.instantiationService.createInstance(InstallExtensionInProfileTask, extensionKey, manifest, extension, options, (operation, token) => {
			if (extension instanceof URI) {
				return this.extractVSIX(extensionKey, extension, options, token);
			}
			let promise = this.extractingGalleryExtensions.get(extensionKey.toString());
			if (!promise) {
				this.extractingGalleryExtensions.set(extensionKey.toString(), promise = this.downloadAndExtractGalleryExtension(extensionKey, extension, operation, options, token));
				promise.finally(() => this.extractingGalleryExtensions.delete(extensionKey.toString()));
			}
			return promise;
		}, this.extensionsScanner);
	}

	protected createUninstallExtensionTask(extension: ILocalExtension, options: UninstallExtensionTaskOptions): IUninstallExtensionTask {
		return new UninstallExtensionInProfileTask(extension, options, this.extensionsProfileScannerService);
	}

	private async downloadAndExtractGalleryExtension(extensionKey: ExtensionKey, gallery: IGalleryExtension, operation: InstallOperation, options: InstallExtensionTaskOptions, token: CancellationToken): Promise<ExtractExtensionResult> {
		const { verificationStatus, location } = await this.extensionsDownloader.download(gallery, operation, !options.donotVerifySignature, options.context?.[EXTENSION_INSTALL_CLIENT_TARGET_PLATFORM_CONTEXT]);
		try {

			if (token.isCancellationRequested) {
				throw new CancellationError();
			}

			// validate manifest
			const manifest = await getManifest(location.fsPath);
			if (!new ExtensionKey(gallery.identifier, gallery.version).equals(new ExtensionKey({ id: getGalleryExtensionId(manifest.publisher, manifest.name) }, manifest.version))) {
				throw new ExtensionManagementError(nls.localize('invalidManifest', "Cannot install '{0}' extension because of manifest mismatch with Marketplace", gallery.identifier.id), ExtensionManagementErrorCode.Invalid);
			}

			const local = await this.extensionsScanner.extractUserExtension(
				extensionKey,
				location.fsPath,
				{
					id: gallery.identifier.uuid,
					publisherId: gallery.publisherId,
					publisherDisplayName: gallery.publisherDisplayName,
					targetPlatform: gallery.properties.targetPlatform,
					isApplicationScoped: options.isApplicationScoped,
					isMachineScoped: options.isMachineScoped,
					isBuiltin: options.isBuiltin,
					isPreReleaseVersion: gallery.properties.isPreReleaseVersion,
					hasPreReleaseVersion: gallery.properties.isPreReleaseVersion,
					installedTimestamp: Date.now(),
					pinned: options.installGivenVersion ? true : !!options.pinned,
					preRelease: isBoolean(options.preRelease)
						? options.preRelease
						: options.installPreReleaseVersion || gallery.properties.isPreReleaseVersion,
					source: 'gallery',
				},
				false,
				token);
			return { local, verificationStatus };
		} catch (error) {
			try {
				await this.extensionsDownloader.delete(location);
			} catch (e) {
				/* Ignore */
				this.logService.warn(`Error while deleting the downloaded file`, location.toString(), getErrorMessage(e));
			}
			throw toExtensionManagementError(error);
		}
	}

	private async extractVSIX(extensionKey: ExtensionKey, location: URI, options: InstallExtensionTaskOptions, token: CancellationToken): Promise<ExtractExtensionResult> {
		const local = await this.extensionsScanner.extractUserExtension(
			extensionKey,
			path.resolve(location.fsPath),
			{
				isApplicationScoped: options.isApplicationScoped,
				isMachineScoped: options.isMachineScoped,
				isBuiltin: options.isBuiltin,
				installedTimestamp: Date.now(),
				pinned: options.installGivenVersion ? true : !!options.pinned,
				source: 'vsix',
			},
			options.keepExisting ?? true,
			token);
		return { local };
	}

	private async collectFiles(extension: ILocalExtension): Promise<IFile[]> {

		const collectFilesFromDirectory = async (dir: string): Promise<string[]> => {
			let entries = await pfs.Promises.readdir(dir);
			entries = entries.map(e => path.join(dir, e));
			const stats = await Promise.all(entries.map(e => fs.promises.stat(e)));
			let promise: Promise<string[]> = Promise.resolve([]);
			stats.forEach((stat, index) => {
				const entry = entries[index];
				if (stat.isFile()) {
					promise = promise.then(result => ([...result, entry]));
				}
				if (stat.isDirectory()) {
					promise = promise
						.then(result => collectFilesFromDirectory(entry)
							.then(files => ([...result, ...files])));
				}
			});
			return promise;
		};

		const files = await collectFilesFromDirectory(extension.location.fsPath);
		return files.map(f => ({ path: `extension/${path.relative(extension.location.fsPath, f)}`, localPath: f }));
	}

	private async onDidChangeExtensionsFromAnotherSource({ added, removed }: DidChangeProfileExtensionsEvent): Promise<void> {
		if (removed) {
			const removedExtensions = added && this.uriIdentityService.extUri.isEqual(removed.profileLocation, added.profileLocation)
				? removed.extensions.filter(e => added.extensions.every(identifier => !areSameExtensions(identifier, e)))
				: removed.extensions;
			for (const identifier of removedExtensions) {
				this.logService.info('Extensions removed from another source', identifier.id, removed.profileLocation.toString());
				this._onDidUninstallExtension.fire({ identifier, profileLocation: removed.profileLocation });
			}
		}
		if (added) {
			const extensions = await this.getInstalled(ExtensionType.User, added.profileLocation);
			const addedExtensions = extensions.filter(e => added.extensions.some(identifier => areSameExtensions(identifier, e.identifier)));
			this._onDidInstallExtensions.fire(addedExtensions.map(local => {
				this.logService.info('Extensions added from another source', local.identifier.id, added.profileLocation.toString());
				return { identifier: local.identifier, local, profileLocation: added.profileLocation, operation: InstallOperation.None };
			}));
		}
	}

	private readonly knownDirectories = new ResourceSet();
	private async watchForExtensionsNotInstalledBySystem(): Promise<void> {
		this._register(this.extensionsScanner.onExtract(resource => this.knownDirectories.add(resource)));
		const stat = await this.fileService.resolve(this.extensionsScannerService.userExtensionsLocation);
		for (const childStat of stat.children ?? []) {
			if (childStat.isDirectory) {
				this.knownDirectories.add(childStat.resource);
			}
		}
		this._register(this.fileService.watch(this.extensionsScannerService.userExtensionsLocation));
		this._register(this.fileService.onDidFilesChange(e => this.onDidFilesChange(e)));
	}

	private async onDidFilesChange(e: FileChangesEvent): Promise<void> {
		if (!e.affects(this.extensionsScannerService.userExtensionsLocation, FileChangeType.ADDED)) {
			return;
		}

		const added: ILocalExtension[] = [];
		for (const resource of e.rawAdded) {
			// Check if this is a known directory
			if (this.knownDirectories.has(resource)) {
				continue;
			}

			// Is not immediate child of extensions resource
			if (!this.uriIdentityService.extUri.isEqual(this.uriIdentityService.extUri.dirname(resource), this.extensionsScannerService.userExtensionsLocation)) {
				continue;
			}

			// .obsolete file changed
			if (this.uriIdentityService.extUri.isEqual(resource, this.uriIdentityService.extUri.joinPath(this.extensionsScannerService.userExtensionsLocation, '.obsolete'))) {
				continue;
			}

			// Ignore changes to files starting with `.`
			if (this.uriIdentityService.extUri.basename(resource).startsWith('.')) {
				continue;
			}

			// Check if this is a directory
			if (!(await this.fileService.stat(resource)).isDirectory) {
				continue;
			}

			// Check if this is an extension added by another source
			// Extension added by another source will not have installed timestamp
			const extension = await this.extensionsScanner.scanUserExtensionAtLocation(resource);
			if (extension && extension.installedTimestamp === undefined) {
				this.knownDirectories.add(resource);
				added.push(extension);
			}
		}

		if (added.length) {
			await this.addExtensionsToProfile(added.map(e => [e, undefined]), this.userDataProfilesService.defaultProfile.extensionsResource);
			this.logService.info('Added extensions to default profile from external source', added.map(e => e.identifier.id));
		}
	}

	private async addExtensionsToProfile(extensions: [ILocalExtension, Metadata | undefined][], profileLocation: URI): Promise<void> {
		const localExtensions = extensions.map(e => e[0]);
		await this.setInstalled(localExtensions);
		await this.extensionsProfileScannerService.addExtensionsToProfile(extensions, profileLocation);
		this._onDidInstallExtensions.fire(localExtensions.map(local => ({ local, identifier: local.identifier, operation: InstallOperation.None, profileLocation })));
	}

	private async setInstalled(extensions: ILocalExtension[]): Promise<void> {
		const uninstalled = await this.extensionsScanner.getUninstalledExtensions();
		for (const extension of extensions) {
			const extensionKey = ExtensionKey.create(extension);
			if (!uninstalled[extensionKey.toString()]) {
				continue;
			}
			this.logService.trace('Removing the extension from uninstalled list:', extensionKey.id);
			await this.extensionsScanner.setInstalled(extensionKey);
			this.logService.info('Removed the extension from uninstalled list:', extensionKey.id);
		}
	}
}

type UpdateMetadataErrorClassification = {
	owner: 'sandy081';
	comment: 'Update metadata error';
	extensionId: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'extension identifier' };
	code?: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'error code' };
	isProfile?: { classification: 'SystemMetaData'; purpose: 'FeatureInsight'; comment: 'Is writing into profile' };
};
type UpdateMetadataErrorEvent = {
	extensionId: string;
	code?: string;
	isProfile?: boolean;
};

export class ExtensionsScanner extends Disposable {

	private readonly uninstalledResource: URI;
	private readonly uninstalledFileLimiter: Queue<any>;

	private readonly _onExtract = this._register(new Emitter<URI>());
	readonly onExtract = this._onExtract.event;

	private scanAllExtensionPromise = new ResourceMap<Promise<IScannedExtension[]>>();
	private scanUserExtensionsPromise = new ResourceMap<Promise<IScannedExtension[]>>();

	constructor(
		private readonly beforeRemovingExtension: (e: ILocalExtension) => Promise<void>,
		@IFileService private readonly fileService: IFileService,
		@IExtensionsScannerService private readonly extensionsScannerService: IExtensionsScannerService,
		@IExtensionsProfileScannerService private readonly extensionsProfileScannerService: IExtensionsProfileScannerService,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
		this.uninstalledResource = joinPath(this.extensionsScannerService.userExtensionsLocation, '.obsolete');
		this.uninstalledFileLimiter = new Queue();
	}

	async cleanUp(): Promise<void> {
		await this.removeTemporarilyDeletedFolders();
		await this.removeUninstalledExtensions();
	}

	async scanExtensions(type: ExtensionType | null, profileLocation: URI, productVersion: IProductVersion): Promise<ILocalExtension[]> {
		try {
			const userScanOptions: ScanOptions = { includeInvalid: true, profileLocation, productVersion };
			let scannedExtensions: IScannedExtension[] = [];
			if (type === null || type === ExtensionType.System) {
				let scanAllExtensionsPromise = this.scanAllExtensionPromise.get(profileLocation);
				if (!scanAllExtensionsPromise) {
					scanAllExtensionsPromise = this.extensionsScannerService.scanAllExtensions({ includeInvalid: true, useCache: true }, userScanOptions, false)
						.finally(() => this.scanAllExtensionPromise.delete(profileLocation));
					this.scanAllExtensionPromise.set(profileLocation, scanAllExtensionsPromise);
				}
				scannedExtensions.push(...await scanAllExtensionsPromise);
			} else if (type === ExtensionType.User) {
				let scanUserExtensionsPromise = this.scanUserExtensionsPromise.get(profileLocation);
				if (!scanUserExtensionsPromise) {
					scanUserExtensionsPromise = this.extensionsScannerService.scanUserExtensions(userScanOptions)
						.finally(() => this.scanUserExtensionsPromise.delete(profileLocation));
					this.scanUserExtensionsPromise.set(profileLocation, scanUserExtensionsPromise);
				}
				scannedExtensions.push(...await scanUserExtensionsPromise);
			}
			scannedExtensions = type !== null ? scannedExtensions.filter(r => r.type === type) : scannedExtensions;
			return await Promise.all(scannedExtensions.map(extension => this.toLocalExtension(extension)));
		} catch (error) {
			throw toExtensionManagementError(error, ExtensionManagementErrorCode.Scanning);
		}
	}

	async scanAllUserExtensions(excludeOutdated: boolean): Promise<ILocalExtension[]> {
		try {
			const scannedExtensions = await this.extensionsScannerService.scanUserExtensions({ includeAllVersions: !excludeOutdated, includeInvalid: true });
			return await Promise.all(scannedExtensions.map(extension => this.toLocalExtension(extension)));
		} catch (error) {
			throw toExtensionManagementError(error, ExtensionManagementErrorCode.Scanning);
		}
	}

	async scanUserExtensionAtLocation(location: URI): Promise<ILocalExtension | null> {
		try {
			const scannedExtension = await this.extensionsScannerService.scanExistingExtension(location, ExtensionType.User, { includeInvalid: true });
			if (scannedExtension) {
				return await this.toLocalExtension(scannedExtension);
			}
		} catch (error) {
			this.logService.error(error);
		}
		return null;
	}

	async extractUserExtension(extensionKey: ExtensionKey, zipPath: string, metadata: Metadata, removeIfExists: boolean, token: CancellationToken): Promise<ILocalExtension> {
		const folderName = extensionKey.toString();
		const tempLocation = URI.file(path.join(this.extensionsScannerService.userExtensionsLocation.fsPath, `.${generateUuid()}`));
		const extensionLocation = URI.file(path.join(this.extensionsScannerService.userExtensionsLocation.fsPath, folderName));

		if (await this.fileService.exists(extensionLocation)) {
			if (!removeIfExists) {
				try {
					return await this.scanLocalExtension(extensionLocation, ExtensionType.User);
				} catch (error) {
					this.logService.warn(`Error while scanning the existing extension at ${extensionLocation.path}. Deleting the existing extension and extracting it.`, getErrorMessage(error));
				}
			}

			try {
				await this.deleteExtensionFromLocation(extensionKey.id, extensionLocation, 'removeExisting');
			} catch (error) {
				throw new ExtensionManagementError(nls.localize('errorDeleting', "Unable to delete the existing folder '{0}' while installing the extension '{1}'. Please delete the folder manually and try again", extensionLocation.fsPath, extensionKey.id), ExtensionManagementErrorCode.Delete);
			}
		}

		try {
			if (token.isCancellationRequested) {
				throw new CancellationError();
			}

			// Extract
			try {
				this.logService.trace(`Started extracting the extension from ${zipPath} to ${extensionLocation.fsPath}`);
				await extract(zipPath, tempLocation.fsPath, { sourcePath: 'extension', overwrite: true }, token);
				this.logService.info(`Extracted extension to ${extensionLocation}:`, extensionKey.id);
			} catch (e) {
				throw fromExtractError(e);
			}

			try {
				await this.extensionsScannerService.updateMetadata(tempLocation, metadata);
			} catch (error) {
				this.telemetryService.publicLog2<UpdateMetadataErrorEvent, UpdateMetadataErrorClassification>('extension:extract', { extensionId: extensionKey.id, code: `${toFileOperationResult(error)}` });
				throw toExtensionManagementError(error, ExtensionManagementErrorCode.UpdateMetadata);
			}

			if (token.isCancellationRequested) {
				throw new CancellationError();
			}

			// Rename
			try {
				this.logService.trace(`Started renaming the extension from ${tempLocation.fsPath} to ${extensionLocation.fsPath}`);
				await this.rename(tempLocation.fsPath, extensionLocation.fsPath);
				this.logService.info('Renamed to', extensionLocation.fsPath);
			} catch (error) {
				if (error.code === 'ENOTEMPTY') {
					this.logService.info(`Rename failed because extension was installed by another source. So ignoring renaming.`, extensionKey.id);
					try { await this.fileService.del(tempLocation, { recursive: true }); } catch (e) { /* ignore */ }
				} else {
					this.logService.info(`Rename failed because of ${getErrorMessage(error)}. Deleted from extracted location`, tempLocation);
					throw error;
				}
			}

			this._onExtract.fire(extensionLocation);

		} catch (error) {
			try { await this.fileService.del(tempLocation, { recursive: true }); } catch (e) { /* ignore */ }
			throw error;
		}

		return this.scanLocalExtension(extensionLocation, ExtensionType.User);
	}

	async scanMetadata(local: ILocalExtension, profileLocation?: URI): Promise<Metadata | undefined> {
		if (profileLocation) {
			const extension = await this.getScannedExtension(local, profileLocation);
			return extension?.metadata;
		} else {
			return this.extensionsScannerService.scanMetadata(local.location);
		}
	}

	private async getScannedExtension(local: ILocalExtension, profileLocation: URI): Promise<IScannedProfileExtension | undefined> {
		const extensions = await this.extensionsProfileScannerService.scanProfileExtensions(profileLocation);
		return extensions.find(e => areSameExtensions(e.identifier, local.identifier));
	}

	async updateMetadata(local: ILocalExtension, metadata: Partial<Metadata>, profileLocation?: URI): Promise<ILocalExtension> {
		try {
			if (profileLocation) {
				await this.extensionsProfileScannerService.updateMetadata([[local, metadata]], profileLocation);
			} else {
				await this.extensionsScannerService.updateMetadata(local.location, metadata);
			}
		} catch (error) {
			this.telemetryService.publicLog2<UpdateMetadataErrorEvent, UpdateMetadataErrorClassification>('extension:extract', { extensionId: local.identifier.id, code: `${toFileOperationResult(error)}`, isProfile: !!profileLocation });
			throw toExtensionManagementError(error, ExtensionManagementErrorCode.UpdateMetadata);
		}
		return this.scanLocalExtension(local.location, local.type, profileLocation);
	}

	async getUninstalledExtensions(): Promise<IStringDictionary<boolean>> {
		try {
			return await this.withUninstalledExtensions();
		} catch (error) {
			throw toExtensionManagementError(error, ExtensionManagementErrorCode.ReadUninstalled);
		}
	}

	async setUninstalled(...extensions: IExtension[]): Promise<void> {
		const extensionKeys: ExtensionKey[] = extensions.map(e => ExtensionKey.create(e));
		await this.withUninstalledExtensions(uninstalled =>
			extensionKeys.forEach(extensionKey => {
				uninstalled[extensionKey.toString()] = true;
				this.logService.info('Marked extension as uninstalled', extensionKey.toString());
			}));
	}

	async setInstalled(extensionKey: ExtensionKey): Promise<void> {
		try {
			await this.withUninstalledExtensions(uninstalled => delete uninstalled[extensionKey.toString()]);
		} catch (error) {
			throw toExtensionManagementError(error, ExtensionManagementErrorCode.UnsetUninstalled);
		}
	}

	async removeExtension(extension: ILocalExtension | IScannedExtension, type: string): Promise<void> {
		if (this.uriIdentityService.extUri.isEqualOrParent(extension.location, this.extensionsScannerService.userExtensionsLocation)) {
			return this.deleteExtensionFromLocation(extension.identifier.id, extension.location, type);
		}
	}

	async removeUninstalledExtension(extension: ILocalExtension | IScannedExtension): Promise<void> {
		await this.removeExtension(extension, 'uninstalled');
		await this.withUninstalledExtensions(uninstalled => delete uninstalled[ExtensionKey.create(extension).toString()]);
	}

	async copyExtension(extension: ILocalExtension, fromProfileLocation: URI, toProfileLocation: URI, metadata: Partial<Metadata>): Promise<ILocalExtension> {
		const source = await this.getScannedExtension(extension, fromProfileLocation);
		const target = await this.getScannedExtension(extension, toProfileLocation);
		metadata = { ...source?.metadata, ...metadata };

		if (target) {
			if (this.uriIdentityService.extUri.isEqual(target.location, extension.location)) {
				await this.extensionsProfileScannerService.updateMetadata([[extension, { ...target.metadata, ...metadata }]], toProfileLocation);
			} else {
				const targetExtension = await this.scanLocalExtension(target.location, extension.type, toProfileLocation);
				await this.extensionsProfileScannerService.removeExtensionFromProfile(targetExtension, toProfileLocation);
				await this.extensionsProfileScannerService.addExtensionsToProfile([[extension, { ...target.metadata, ...metadata }]], toProfileLocation);
			}
		} else {
			await this.extensionsProfileScannerService.addExtensionsToProfile([[extension, metadata]], toProfileLocation);
		}

		return this.scanLocalExtension(extension.location, extension.type, toProfileLocation);
	}

	async copyExtensions(fromProfileLocation: URI, toProfileLocation: URI, productVersion: IProductVersion): Promise<void> {
		const fromExtensions = await this.scanExtensions(ExtensionType.User, fromProfileLocation, productVersion);
		const extensions: [ILocalExtension, Metadata | undefined][] = await Promise.all(fromExtensions
			.filter(e => !e.isApplicationScoped) /* remove application scoped extensions */
			.map(async e => ([e, await this.scanMetadata(e, fromProfileLocation)])));
		await this.extensionsProfileScannerService.addExtensionsToProfile(extensions, toProfileLocation);
	}

	private async deleteExtensionFromLocation(id: string, location: URI, type: string): Promise<void> {
		this.logService.trace(`Deleting ${type} extension from disk`, id, location.fsPath);
		const renamedLocation = this.uriIdentityService.extUri.joinPath(this.uriIdentityService.extUri.dirname(location), `${this.uriIdentityService.extUri.basename(location)}.${hash(generateUuid()).toString(16)}${DELETED_FOLDER_POSTFIX}`);
		await this.rename(location.fsPath, renamedLocation.fsPath);
		await this.fileService.del(renamedLocation, { recursive: true });
		this.logService.info(`Deleted ${type} extension from disk`, id, location.fsPath);
	}

	private withUninstalledExtensions(updateFn?: (uninstalled: IStringDictionary<boolean>) => void): Promise<IStringDictionary<boolean>> {
		return this.uninstalledFileLimiter.queue(async () => {
			let raw: string | undefined;
			try {
				const content = await this.fileService.readFile(this.uninstalledResource, 'utf8');
				raw = content.value.toString();
			} catch (error) {
				if (toFileOperationResult(error) !== FileOperationResult.FILE_NOT_FOUND) {
					throw error;
				}
			}

			let uninstalled = {};
			if (raw) {
				try {
					uninstalled = JSON.parse(raw);
				} catch (e) { /* ignore */ }
			}

			if (updateFn) {
				updateFn(uninstalled);
				if (Object.keys(uninstalled).length) {
					await this.fileService.writeFile(this.uninstalledResource, VSBuffer.fromString(JSON.stringify(uninstalled)));
				} else {
					await this.fileService.del(this.uninstalledResource);
				}
			}

			return uninstalled;
		});
	}

	private async rename(extractPath: string, renamePath: string): Promise<void> {
		try {
			await pfs.Promises.rename(extractPath, renamePath, 2 * 60 * 1000 /* Retry for 2 minutes */);
		} catch (error) {
			throw toExtensionManagementError(error, ExtensionManagementErrorCode.Rename);
		}
	}

	async scanLocalExtension(location: URI, type: ExtensionType, profileLocation?: URI): Promise<ILocalExtension> {
		try {
			if (profileLocation) {
				const scannedExtensions = await this.extensionsScannerService.scanUserExtensions({ profileLocation });
				const scannedExtension = scannedExtensions.find(e => this.uriIdentityService.extUri.isEqual(e.location, location));
				if (scannedExtension) {
					return await this.toLocalExtension(scannedExtension);
				}
			} else {
				const scannedExtension = await this.extensionsScannerService.scanExistingExtension(location, type, { includeInvalid: true });
				if (scannedExtension) {
					return await this.toLocalExtension(scannedExtension);
				}
			}
			throw new ExtensionManagementError(nls.localize('cannot read', "Cannot read the extension from {0}", location.path), ExtensionManagementErrorCode.ScanningExtension);
		} catch (error) {
			throw toExtensionManagementError(error, ExtensionManagementErrorCode.ScanningExtension);
		}
	}

	private async toLocalExtension(extension: IScannedExtension): Promise<ILocalExtension> {
		const stat = await this.fileService.resolve(extension.location);
		let readmeUrl: URI | undefined;
		let changelogUrl: URI | undefined;
		if (stat.children) {
			readmeUrl = stat.children.find(({ name }) => /^readme(\.txt|\.md|)$/i.test(name))?.resource;
			changelogUrl = stat.children.find(({ name }) => /^changelog(\.txt|\.md|)$/i.test(name))?.resource;
		}
		return {
			identifier: extension.identifier,
			type: extension.type,
			isBuiltin: extension.isBuiltin || !!extension.metadata?.isBuiltin,
			location: extension.location,
			manifest: extension.manifest,
			targetPlatform: extension.targetPlatform,
			validations: extension.validations,
			isValid: extension.isValid,
			readmeUrl,
			changelogUrl,
			publisherDisplayName: extension.metadata?.publisherDisplayName,
			publisherId: extension.metadata?.publisherId || null,
			isApplicationScoped: !!extension.metadata?.isApplicationScoped,
			isMachineScoped: !!extension.metadata?.isMachineScoped,
			isPreReleaseVersion: !!extension.metadata?.isPreReleaseVersion,
			hasPreReleaseVersion: !!extension.metadata?.hasPreReleaseVersion,
			preRelease: !!extension.metadata?.preRelease,
			installedTimestamp: extension.metadata?.installedTimestamp,
			updated: !!extension.metadata?.updated,
			pinned: !!extension.metadata?.pinned,
			isWorkspaceScoped: false,
			source: extension.metadata?.source ?? (extension.identifier.uuid ? 'gallery' : 'vsix')
		};
	}

	private async removeUninstalledExtensions(): Promise<void> {
		const uninstalled = await this.getUninstalledExtensions();
		if (Object.keys(uninstalled).length === 0) {
			this.logService.debug(`No uninstalled extensions found.`);
			return;
		}

		this.logService.debug(`Removing uninstalled extensions:`, Object.keys(uninstalled));

		const extensions = await this.extensionsScannerService.scanUserExtensions({ includeAllVersions: true, includeUninstalled: true, includeInvalid: true }); // All user extensions
		const installed: Set<string> = new Set<string>();
		for (const e of extensions) {
			if (!uninstalled[ExtensionKey.create(e).toString()]) {
				installed.add(e.identifier.id.toLowerCase());
			}
		}

		try {
			// running post uninstall tasks for extensions that are not installed anymore
			const byExtension = groupByExtension(extensions, e => e.identifier);
			await Promises.settled(byExtension.map(async e => {
				const latest = e.sort((a, b) => semver.rcompare(a.manifest.version, b.manifest.version))[0];
				if (!installed.has(latest.identifier.id.toLowerCase())) {
					await this.beforeRemovingExtension(await this.toLocalExtension(latest));
				}
			}));
		} catch (error) {
			this.logService.error(error);
		}

		const toRemove = extensions.filter(e => e.metadata /* Installed by System */ && uninstalled[ExtensionKey.create(e).toString()]);
		await Promise.allSettled(toRemove.map(e => this.removeUninstalledExtension(e)));
	}

	private async removeTemporarilyDeletedFolders(): Promise<void> {
		this.logService.trace('ExtensionManagementService#removeTempDeleteFolders');

		let stat;
		try {
			stat = await this.fileService.resolve(this.extensionsScannerService.userExtensionsLocation);
		} catch (error) {
			if (toFileOperationResult(error) !== FileOperationResult.FILE_NOT_FOUND) {
				this.logService.error(error);
			}
			return;
		}

		if (!stat?.children) {
			return;
		}

		try {
			await Promise.allSettled(stat.children.map(async child => {
				if (!child.isDirectory || !child.name.endsWith(DELETED_FOLDER_POSTFIX)) {
					return;
				}
				this.logService.trace('Deleting the temporarily deleted folder', child.resource.toString());
				try {
					await this.fileService.del(child.resource, { recursive: true });
					this.logService.trace('Deleted the temporarily deleted folder', child.resource.toString());
				} catch (error) {
					if (toFileOperationResult(error) !== FileOperationResult.FILE_NOT_FOUND) {
						this.logService.error(error);
					}
				}
			}));
		} catch (error) { /* ignore */ }
	}

}

class InstallExtensionInProfileTask extends AbstractExtensionTask<ILocalExtension> implements IInstallExtensionTask {

	private _operation = InstallOperation.Install;
	get operation() { return this.options.operation ?? this._operation; }

	private _verificationStatus: ExtensionVerificationStatus | undefined;
	get verificationStatus() { return this._verificationStatus; }

	readonly identifier: IExtensionIdentifier;

	constructor(
		private readonly extensionKey: ExtensionKey,
		readonly manifest: IExtensionManifest,
		readonly source: IGalleryExtension | URI,
		readonly options: InstallExtensionTaskOptions,
		private readonly extractExtensionFn: (operation: InstallOperation, token: CancellationToken) => Promise<ExtractExtensionResult>,
		private readonly extensionsScanner: ExtensionsScanner,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService,
		@IExtensionGalleryService private readonly galleryService: IExtensionGalleryService,
		@IUserDataProfilesService private readonly userDataProfilesService: IUserDataProfilesService,
		@IExtensionsScannerService private readonly extensionsScannerService: IExtensionsScannerService,
		@IExtensionsProfileScannerService private readonly extensionsProfileScannerService: IExtensionsProfileScannerService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
		this.identifier = this.extensionKey.identifier;
	}

	protected async doRun(token: CancellationToken): Promise<ILocalExtension> {
		const installed = await this.extensionsScanner.scanExtensions(ExtensionType.User, this.options.profileLocation, this.options.productVersion);
		const existingExtension = installed.find(i => areSameExtensions(i.identifier, this.identifier));
		if (existingExtension) {
			this._operation = InstallOperation.Update;
		}

		const metadata: Metadata = {
			isApplicationScoped: this.options.isApplicationScoped || existingExtension?.isApplicationScoped,
			isMachineScoped: this.options.isMachineScoped || existingExtension?.isMachineScoped,
			isBuiltin: this.options.isBuiltin || existingExtension?.isBuiltin,
			isSystem: existingExtension?.type === ExtensionType.System ? true : undefined,
			installedTimestamp: Date.now(),
			pinned: this.options.installGivenVersion ? true : (this.options.pinned ?? existingExtension?.pinned),
			source: this.source instanceof URI ? 'vsix' : 'gallery',
		};

		let local: ILocalExtension | undefined;

		// VSIX
		if (this.source instanceof URI) {
			if (existingExtension) {
				if (this.extensionKey.equals(new ExtensionKey(existingExtension.identifier, existingExtension.manifest.version))) {
					try {
						await this.extensionsScanner.removeExtension(existingExtension, 'existing');
					} catch (e) {
						throw new Error(nls.localize('restartCode', "Please restart VS Code before reinstalling {0}.", this.manifest.displayName || this.manifest.name));
					}
				}
			}
			// Remove the extension with same version if it is already uninstalled.
			// Installing a VSIX extension shall replace the existing extension always.
			const existingWithSameVersion = await this.unsetIfUninstalled(this.extensionKey);
			if (existingWithSameVersion) {
				try {
					await this.extensionsScanner.removeExtension(existingWithSameVersion, 'existing');
				} catch (e) {
					throw new Error(nls.localize('restartCode', "Please restart VS Code before reinstalling {0}.", this.manifest.displayName || this.manifest.name));
				}
			}

		}

		// Gallery
		else {
			metadata.id = this.source.identifier.uuid;
			metadata.publisherId = this.source.publisherId;
			metadata.publisherDisplayName = this.source.publisherDisplayName;
			metadata.targetPlatform = this.source.properties.targetPlatform;
			metadata.updated = !!existingExtension;
			metadata.isPreReleaseVersion = this.source.properties.isPreReleaseVersion;
			metadata.hasPreReleaseVersion = existingExtension?.hasPreReleaseVersion || this.source.properties.isPreReleaseVersion;
			metadata.preRelease = isBoolean(this.options.preRelease)
				? this.options.preRelease
				: this.options.installPreReleaseVersion || this.source.properties.isPreReleaseVersion || existingExtension?.preRelease;

			if (existingExtension && existingExtension.type !== ExtensionType.System && existingExtension.manifest.version === this.source.version) {
				return this.extensionsScanner.updateMetadata(existingExtension, metadata, this.options.profileLocation);
			}

			// Unset if the extension is uninstalled and return the unset extension.
			local = await this.unsetIfUninstalled(this.extensionKey);
		}

		if (token.isCancellationRequested) {
			throw toExtensionManagementError(new CancellationError());
		}

		if (!local) {
			const result = await this.extractExtensionFn(this.operation, token);
			local = result.local;
			this._verificationStatus = result.verificationStatus;
		}

		if (this.uriIdentityService.extUri.isEqual(this.userDataProfilesService.defaultProfile.extensionsResource, this.options.profileLocation)) {
			try {
				await this.extensionsScannerService.initializeDefaultProfileExtensions();
			} catch (error) {
				throw toExtensionManagementError(error, ExtensionManagementErrorCode.IntializeDefaultProfile);
			}
		}

		if (token.isCancellationRequested) {
			throw toExtensionManagementError(new CancellationError());
		}

		try {
			await this.extensionsProfileScannerService.addExtensionsToProfile([[local, metadata]], this.options.profileLocation, !local.isValid);
		} catch (error) {
			throw toExtensionManagementError(error, ExtensionManagementErrorCode.AddToProfile);
		}

		const result = await this.extensionsScanner.scanLocalExtension(local.location, ExtensionType.User, this.options.profileLocation);
		if (!result) {
			throw new ExtensionManagementError('Cannot find the installed extension', ExtensionManagementErrorCode.InstalledExtensionNotFound);
		}

		if (this.source instanceof URI) {
			this.updateMetadata(local, token);
		}

		return result;
	}

	private async unsetIfUninstalled(extensionKey: ExtensionKey): Promise<ILocalExtension | undefined> {
		const uninstalled = await this.extensionsScanner.getUninstalledExtensions();
		if (!uninstalled[extensionKey.toString()]) {
			return undefined;
		}

		this.logService.trace('Removing the extension from uninstalled list:', extensionKey.id);
		// If the same version of extension is marked as uninstalled, remove it from there and return the local.
		await this.extensionsScanner.setInstalled(extensionKey);
		this.logService.info('Removed the extension from uninstalled list:', extensionKey.id);

		const userExtensions = await this.extensionsScanner.scanAllUserExtensions(true);
		return userExtensions.find(i => ExtensionKey.create(i).equals(extensionKey));
	}

	private async updateMetadata(extension: ILocalExtension, token: CancellationToken): Promise<void> {
		try {
			let [galleryExtension] = await this.galleryService.getExtensions([{ id: extension.identifier.id, version: extension.manifest.version }], token);
			if (!galleryExtension) {
				[galleryExtension] = await this.galleryService.getExtensions([{ id: extension.identifier.id }], token);
			}
			if (galleryExtension) {
				const metadata = {
					id: galleryExtension.identifier.uuid,
					publisherDisplayName: galleryExtension.publisherDisplayName,
					publisherId: galleryExtension.publisherId,
					isPreReleaseVersion: galleryExtension.properties.isPreReleaseVersion,
					hasPreReleaseVersion: extension.hasPreReleaseVersion || galleryExtension.properties.isPreReleaseVersion,
					preRelease: galleryExtension.properties.isPreReleaseVersion || this.options.installPreReleaseVersion
				};
				await this.extensionsScanner.updateMetadata(extension, metadata, this.options.profileLocation);
			}
		} catch (error) {
			/* Ignore Error */
		}
	}
}

class UninstallExtensionInProfileTask extends AbstractExtensionTask<void> implements IUninstallExtensionTask {

	constructor(
		readonly extension: ILocalExtension,
		readonly options: UninstallExtensionTaskOptions,
		private readonly extensionsProfileScannerService: IExtensionsProfileScannerService,
	) {
		super();
	}

	protected async doRun(token: CancellationToken): Promise<void> {
		await this.extensionsProfileScannerService.removeExtensionFromProfile(this.extension, this.options.profileLocation);
	}

}
