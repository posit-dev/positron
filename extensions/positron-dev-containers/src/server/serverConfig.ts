/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import * as os from 'os';
import * as path from 'path';
import { getLogger } from '../common/logger';

/**
 * Server platform information
 */
export interface ServerPlatform {
	/**
	 * Platform name (linux, darwin, win32)
	 */
	platform: string;

	/**
	 * Architecture (x64, arm64)
	 */
	arch: string;

	/**
	 * Combined platform string (e.g., "linux-x64", "darwin-arm64")
	 */
	platformString: string;
}

/**
 * Server configuration
 */
export interface ServerConfig {
	/**
	 * Positron version (e.g., "2024.12.0")
	 */
	version: string;

	/**
	 * Positron commit SHA
	 */
	commit: string;

	/**
	 * Quality (stable, insider)
	 */
	quality: string;

	/**
	 * Server download URL
	 */
	downloadUrl: string;

	/**
	 * Server install directory name
	 */
	serverDirName: string;

	/**
	 * Platform information
	 */
	platform: ServerPlatform;
}

// Default download URL template - matches the format used by open-remote-ssh
const DEFAULT_DOWNLOAD_URL_TEMPLATE = 'https://cdn.posit.co/positron/dailies/reh/${arch-long}/positron-reh-${os}-${arch}-${version}.tar.gz';

/**
 * Server configuration provider
 */
export class ServerConfigProvider {
	private static instance: ServerConfigProvider;
	private logger = getLogger();

	private constructor() { }

	/**
	 * Get the singleton instance
	 */
	public static getInstance(): ServerConfigProvider {
		if (!ServerConfigProvider.instance) {
			ServerConfigProvider.instance = new ServerConfigProvider();
		}
		return ServerConfigProvider.instance;
	}

	/**
	 * Get server configuration for the host platform
	 */
	public getServerConfig(): ServerConfig {
		const version = this.getVersion();
		const commit = this.getCommitId();
		const quality = this.getQuality();
		const platform = this.getPlatformInfo();

		const serverDirName = `positron-server-${version}`;
		const downloadUrl = this.getDownloadUrl(version, commit, quality, platform);

		this.logger.info(`Server config: version=${version}, commit=${commit}, quality=${quality}, platform=${platform.platformString}`);

		return {
			version,
			commit,
			quality,
			downloadUrl,
			serverDirName,
			platform
		};
	}

	/**
	 * Get server configuration for a specific container platform
	 * @param containerPlatform Platform detected in container (linux, darwin)
	 * @param containerArch Architecture detected in container (x64, arm64, aarch64)
	 */
	public getServerConfigForContainer(containerPlatform: string, containerArch: string): ServerConfig {
		const version = this.getVersion();
		const commit = this.getCommitId();
		const quality = this.getQuality();

		// Normalize architecture names
		const normalizedArch = this.normalizeArch(containerArch);

		const platform: ServerPlatform = {
			platform: containerPlatform,
			arch: normalizedArch,
			platformString: `${containerPlatform}-${normalizedArch}`
		};

		const serverDirName = `positron-server-${version}`;
		const downloadUrl = this.getDownloadUrl(version, commit, quality, platform);

		this.logger.info(`Container server config: version=${version}, commit=${commit}, quality=${quality}, platform=${platform.platformString}`);

		return {
			version,
			commit,
			quality,
			downloadUrl,
			serverDirName,
			platform
		};
	}

	/**
	 * Get the version string in the format used by Positron (version-buildNumber)
	 */
	private getVersion(): string {
		return `${positron.version}-${positron.buildNumber}`;
	}

	/**
	 * Get the commit ID from the environment or from VS Code API
	 */
	private getCommitId(): string {
		// Try to get from environment variable first (set by Positron build)
		const envCommit = process.env.VSCODE_COMMIT;
		if (envCommit) {
			return envCommit;
		}

		// Fallback to extracting from app root
		// The commit is typically stored in product.json
		try {
			// Get the app root
			const appRoot = vscode.env.appRoot;
			const productPath = path.join(appRoot, 'product.json');


			const product = require(productPath);
			if (product.commit) {
				return product.commit;
			}
		} catch (error) {
			this.logger.error(`Failed to read commit from product.json: ${error}`);
		}

		// If all else fails, use a placeholder
		// This should not happen in production builds
		this.logger.warn('Could not determine commit ID, using placeholder');
		return 'unknown';
	}

	/**
	 * Get the quality (stable, insider) from the environment
	 */
	private getQuality(): string {
		// Check if this is an insider build
		const appName = vscode.env.appName.toLowerCase();
		if (appName.includes('insider') || appName.includes('insiders')) {
			return 'insider';
		}

		// Check product.json for quality
		try {
			const appRoot = vscode.env.appRoot;
			const productPath = path.join(appRoot, 'product.json');


			const product = require(productPath);
			if (product.quality) {
				return product.quality;
			}
		} catch (error) {
			this.logger.error(`Failed to read quality from product.json: ${error}`);
		}

		// Default to stable
		return 'stable';
	}

	/**
	 * Get platform information for the host
	 */
	private getPlatformInfo(): ServerPlatform {
		const platform = os.platform();
		const arch = os.arch();

		const normalizedPlatform = this.normalizePlatform(platform);
		const normalizedArch = this.normalizeArch(arch);

		return {
			platform: normalizedPlatform,
			arch: normalizedArch,
			platformString: `${normalizedPlatform}-${normalizedArch}`
		};
	}

	/**
	 * Normalize platform name
	 */
	private normalizePlatform(platform: string): string {
		switch (platform) {
			case 'darwin':
				return 'darwin';
			case 'linux':
				return 'linux';
			case 'win32':
				return 'win32';
			default:
				this.logger.warn(`Unknown platform: ${platform}, defaulting to linux`);
				return 'linux';
		}
	}

	/**
	 * Normalize architecture name
	 */
	private normalizeArch(arch: string): string {
		switch (arch) {
			case 'x64':
			case 'x86_64':
			case 'amd64':
				return 'x64';
			case 'arm64':
			case 'aarch64':
				return 'arm64';
			case 'arm':
			case 'armv7l':
				return 'armhf';
			default:
				this.logger.warn(`Unknown architecture: ${arch}, defaulting to x64`);
				return 'x64';
		}
	}

	/**
	 * Get download URL for the server
	 * @param version Version string (e.g., 2024.10.0-123)
	 * @param commit Commit SHA
	 * @param quality Build quality (stable, insider)
	 * @param platform Platform information
	 */
	private getDownloadUrl(version: string, commit: string, quality: string, platform: ServerPlatform): string {
		// Get the URL template from configuration or use default
		const config = vscode.workspace.getConfiguration('dev.containers');
		const urlTemplate = config.get<string>('serverDownloadUrlTemplate') || DEFAULT_DOWNLOAD_URL_TEMPLATE;

		// Get the long-form architecture name (e.g., x86_64 instead of x64)
		const archLong = this.getArchLong(platform.arch);

		// Replace variables in the template
		return urlTemplate
			.replace(/\$\{quality\}/g, quality)
			.replace(/\$\{version\}/g, version)
			.replace(/\$\{commit\}/g, commit)
			.replace(/\$\{os\}/g, platform.platform)
			.replace(/\$\{arch-long\}/g, archLong)
			.replace(/\$\{arch\}/g, platform.arch);
	}

	/**
	 * Get the long-form architecture name
	 * @param arch Short architecture name (e.g., x64, arm64)
	 * @returns Long architecture name (e.g., x86_64, arm64)
	 */
	private getArchLong(arch: string): string {
		switch (arch) {
			case 'x64':
				return 'x86_64';
			case 'arm64':
				return 'arm64';
			case 'armhf':
				return 'armv7l';
			default:
				return arch;
		}
	}

	/**
	 * Get the server installation path in the container
	 * @param serverConfig Server configuration
	 */
	public getServerInstallPath(serverConfig: ServerConfig): string {
		// Install in the user's home directory under .positron-server
		return `~/.positron-server/${serverConfig.serverDirName}`;
	}

	/**
	 * Get the server data path in the container
	 */
	public getServerDataPath(): string {
		// Data directory for the server
		return '~/.positron-server/data';
	}

	/**
	 * Get the server extensions path in the container
	 */
	public getServerExtensionsPath(): string {
		// Extensions directory for the server
		return '~/.positron-server/extensions';
	}
}

/**
 * Get server configuration provider instance
 */
export function getServerConfigProvider(): ServerConfigProvider {
	return ServerConfigProvider.getInstance();
}
