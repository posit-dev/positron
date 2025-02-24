/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import { IExtensionManagementService } from '../common/extensionManagement.js';
import { IExtensionManifest } from '../../extensions/common/extensions.js';
import { URI } from '../../../base/common/uri.js';
import { join } from 'path';
import { ILogService } from '../../log/common/log.js';
import { IProductService } from '../../product/common/productService.js';
import { INativeEnvironmentService } from '../../environment/common/environment.js';
import { FileOperationResult, IFileService, IFileStat, toFileOperationResult } from '../../files/common/files.js';
import { getErrorMessage } from '../../../base/common/errors.js';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { Disposable } from '../../../base/common/lifecycle.js';

export class PositronBootstrapExtensionsInitializer extends Disposable {
	private readonly storageFilePath: string;

	constructor(
		@INativeEnvironmentService private readonly environmentService: INativeEnvironmentService,
		@IExtensionManagementService private readonly extensionManagementService: IExtensionManagementService,
		@IFileService private readonly fileService: IFileService,
		@IProductService private readonly productService: IProductService,
		@ILogService private readonly logService: ILogService
	) {
		super();

		this.storageFilePath = join(this.getVSIXPath().fsPath, '.version');
		const currentVersion = this.productService.positronVersion;

		const lastKnownVersion = existsSync(this.storageFilePath) ? readFileSync(this.storageFilePath, 'utf8').trim() : '';

		if (lastKnownVersion !== currentVersion) {
			this.logService.info('First launch after first install, upgrade, or downgrade. Installing bootstrapped extensions');
			this.installVSIXOnStartup()
				.then(() => {
					try {
						writeFileSync(this.storageFilePath, currentVersion);
					} catch (error) {
						this.logService.error('Error writing bootstrapped extension storage file', this.storageFilePath, getErrorMessage(error));
					}
				})
				.catch(error => {
					this.logService.error('Error installing bootstrapped extensions', getErrorMessage(error));
				});
		} else {
			this.logService.info('Subsequent launch, skipping bootstrapped extensions');
		}
	}

	async installVSIXOnStartup() {

		const extensionsLocation = this.getVSIXPath();
		let stat: IFileStat;
		try {
			stat = await this.fileService.resolve(extensionsLocation);
			if (!stat.children) {
				this.logService.debug('There are no extensions to install', extensionsLocation.toString());
				return;
			}
		} catch (error) {
			if (toFileOperationResult(error) === FileOperationResult.FILE_NOT_FOUND) {
				this.logService.debug('There are no extensions to install', extensionsLocation.toString());
			}
			this.logService.error('Error initializing extensions', error);
			return;
		}

		const vsixFiles = stat.children.filter(child => child.name.endsWith('.vsix'));
		if (vsixFiles.length === 0) {
			this.logService.debug('There are no VSIX extension files to install', extensionsLocation.toString());
			return;
		}

		const installedExtensions = await this.extensionManagementService.getInstalled();
		await Promise.all(vsixFiles.map(async vsix => {
			this.logService.info('Installing extension:', vsix.resource.toString());
			try {
				const vsixManifest: IExtensionManifest = await this.extensionManagementService.getManifest(vsix.resource);
				const extensionId = vsixManifest.publisher + '.' + vsixManifest.name;

				const installedExtension = installedExtensions.find(e => e.identifier.id === extensionId);
				if (installedExtension) {
					const installedVersion = installedExtension.manifest.version;
					if (!this.isVSIXNewer(installedVersion, vsixManifest.version)) {
						this.logService.info('Extension is already installed and is up to date:', vsix.resource.toString());
						return;
					}
				}
				await this.extensionManagementService.install(vsix.resource, { donotIncludePackAndDependencies: true, keepExisting: false });
				this.logService.info('Successfully installed extension:', vsix.resource.toString());
			} catch (error) {
				this.logService.error('Error installing extension:', vsix.resource.toString(), getErrorMessage(error));
			}
		}));
		this.logService.info('Bootstrapped extensions initialized', extensionsLocation.toString());

	}

	private isVSIXNewer(installedVersion: string, vsixVersion: string): boolean {
		const [iMajor, iMinor, iPatch] = installedVersion.split('.').map(Number);
		const [vMajor, vMinor, vPatch] = vsixVersion.split('.').map(Number);

		return vMajor > iMajor || (vMajor === iMajor && vMinor > iMinor) || (vMajor === iMajor && vMinor === iMinor && vPatch > iPatch);
	}


	private getVSIXPath(): URI {
		return URI.file(join(this.environmentService.appRoot, 'extensions', 'bootstrap'));
	}

	override dispose(): void {
		this.logService.info('Disposing PositronBootstrapExtensionsInitializer');
		super.dispose();
	}
}
