/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { mainWindow } from '../../../../base/browser/window.js';
import { DeferredPromise } from '../../../../base/common/async.js';
import { URI } from '../../../../base/common/uri.js';
import { joinPath } from '../../../../base/common/resources.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { IEncryptionService, KnownStorageProvider } from '../../../../platform/encryption/common/encryptionService.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';

/**
 * Browser-specific encryption service that uses the Web Crypto API
 */
export class BrowserEncryptionService implements IEncryptionService {
	_serviceBrand: undefined;

	private _encryptionKey: CryptoKey | undefined;
	private _keyInitPromise: DeferredPromise<CryptoKey> | undefined;
	private readonly _storageKeyName = 'browser.encryptionKeyWrapped';

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@ILogService private readonly logService: ILogService,
		@IFileService private readonly fileService: IFileService,
		@IEnvironmentService private readonly environmentService: IEnvironmentService
	) {
		this.logService.info('[BrowserEncryptionService] Initializing browser encryption service');
		this.initializeEncryptionKey();
	}

	private async initializeEncryptionKey(): Promise<CryptoKey> {
		this.logService.trace('[BrowserEncryptionService] Initializing encryption key');
		if (!this._keyInitPromise) {
			this._keyInitPromise = new DeferredPromise<CryptoKey>();

			try {
				const storedKeyData = this.storageService.get(this._storageKeyName, StorageScope.APPLICATION);

				if (storedKeyData && storedKeyData !== '{}') {
					this.logService.trace('[BrowserEncryptionService] Found stored key data');
					try {
						// unwrap key using iv and salt
						const wrappedKeyData = JSON.parse(storedKeyData);
						const iv = new Uint8Array(wrappedKeyData.iv);
						const wrappedKey = new Uint8Array(wrappedKeyData.data);

						const salt = await this.getSaltFromFileSystem();
						const wrappingKey = await this.deriveKeyWrappingKey(salt);

						const unwrappedKeyBuffer = await mainWindow.crypto.subtle.decrypt(
							{ name: 'AES-GCM', iv },
							wrappingKey,
							wrappedKey
						);

						const decoder = new TextDecoder();
						const decryptedKeyString = decoder.decode(unwrappedKeyBuffer);
						const keyData = JSON.parse(decryptedKeyString);

						this._encryptionKey = await mainWindow.crypto.subtle.importKey(
							'jwk',
							keyData,
							{ name: 'AES-GCM' },
							true,
							['encrypt', 'decrypt']
						);
						this.logService.trace('[BrowserEncryptionService] Unwrapped encryption key');
						this._keyInitPromise.complete(this._encryptionKey);
					} catch (error) {
						this.logService.error('[BrowserEncryptionService] Error unwrapping encrytption key:', error);
						const key = await this.generateAndStoreEncryptionKey();
						this._keyInitPromise.complete(key);
					}
				} else {
					this.logService.info('[BrowserEncryptionService] No stored key data found');
					const key = await this.generateAndStoreEncryptionKey();
					this._keyInitPromise.complete(key);
				}
			} catch (error) {
				this.logService.error('[BrowserEncryptionService] Error initializing encryption key:', error);
				try {
					const key = await this.generateAndStoreEncryptionKey();
					this._keyInitPromise.complete(key);
				} catch (finalError) {
					this._keyInitPromise.error(finalError);
				}
			}
		}
		return this._keyInitPromise.p;
	}

	private async generateAndStoreEncryptionKey(): Promise<CryptoKey> {
		this.logService.info('[BrowserEncryptionService] Generating encryption key');
		try {
			this._encryptionKey = await mainWindow.crypto.subtle.generateKey(
				{ name: 'AES-GCM', length: 256 },
				true,
				['encrypt', 'decrypt']
			);
			await this.wrapAndStoreKey(this._encryptionKey);
			this.logService.info('[BrowserEncryptionService] Generated encryption key');
			return this._encryptionKey;
		} catch (error) {
			this.logService.error('[BrowserEncryptionService] Error generating encryption key:', error);
			throw error;
		}
	}

	private async wrapAndStoreKey(key: CryptoKey): Promise<void> {
		try {
			// Retrieve salt and derive a key-wrapping key from it
			const salt = await this.getSaltFromFileSystem();
			const wrappingKey = await this.deriveKeyWrappingKey(salt);
			const iv = mainWindow.crypto.getRandomValues(new Uint8Array(12));

			const exportedKey = await mainWindow.crypto.subtle.exportKey('jwk', key);
			const keyString = JSON.stringify(exportedKey);

			const encoder = new TextEncoder();
			const keyData = encoder.encode(keyString);

			const wrappedKeyBuffer = await mainWindow.crypto.subtle.encrypt(
				{ name: 'AES-GCM', iv },
				wrappingKey,
				keyData
			);

			const wrappedKeyData = {
				iv: Array.from(iv),
				data: Array.from(new Uint8Array(wrappedKeyBuffer))
			};

			// Store in storageService
			this.storageService.store(this._storageKeyName, JSON.stringify(wrappedKeyData), StorageScope.APPLICATION, StorageTarget.MACHINE);

			this.logService.trace('[BrowserEncryptionService] Wrapped and stored key');
		} catch (error) {
			this.logService.error('[BrowserEncryptionService] Error wrapping and storing key:', error);
			throw error;
		}
	}

	private async getSaltFromFileSystem(): Promise<Uint8Array> {
		try {
			const saltFileName = '.storage';
			let salt: Uint8Array;

			try {
				const saltBuffer = await this.fileService.readFile(this.getSaltFilePath(saltFileName));
				const saltData = saltBuffer.value.toString();

				if (saltData && saltData.length > 0) {
					salt = new Uint8Array(JSON.parse(saltData));
					this.logService.trace('[BrowserEncryptionService] Retrieved salt from file system');
					return salt;
				}
			} catch (error) {
				this.logService.trace('[BrowserEncryptionService] No existing salt found, generating new salt');
			}
			salt = mainWindow.crypto.getRandomValues(new Uint8Array(16));

			const saltContent = JSON.stringify(Array.from(salt));
			await this.fileService.writeFile(this.getSaltFilePath(saltFileName), VSBuffer.fromString(saltContent));
			this.logService.trace('[BrowserEncryptionService] Wrote new salt to file system');
			return salt;
		} catch (error) {
			this.logService.error('[BrowserEncryptionService] Error getting salt from file system:', error);
			throw new Error('[BrowserEncryptionService] Cannot access file system for encryption salt. Encryption unavailable');
		}
	}

	private getSaltFilePath(saltFileName: string): URI {
		// --- Start Positron ---
		return joinPath(this.environmentService.userRoamingDataHome, 'positron', saltFileName);
		// --- End Positron ---
	}

	private async deriveKeyWrappingKey(salt: Uint8Array): Promise<CryptoKey> {
		try {
			const encoder = new TextEncoder();
			const keyMaterial = await mainWindow.crypto.subtle.importKey(
				'raw',
				encoder.encode('product-key-derivation'),
				{ name: 'PBKDF2' },
				false,
				['deriveBits', 'deriveKey']
			);
			return mainWindow.crypto.subtle.deriveKey(
				{
					name: 'PBKDF2',
					salt,
					iterations: 100000,
					hash: 'SHA-256'
				},
				keyMaterial,
				{ name: 'AES-GCM', length: 256 },
				true,
				['encrypt', 'decrypt']
			);
		} catch (error) {
			this.logService.error('[BrowserEncryptionService] Error deriving key wrapping key:', error);

			return mainWindow.crypto.subtle.generateKey(
				{
					name: 'AES-GCM',
					length: 256
				},
				true,
				['encrypt', 'decrypt']
			);
		}
	}

	private async getEncryptionKey(): Promise<CryptoKey> {
		if (this._encryptionKey) {
			return this._encryptionKey;
		}
		const key = await this.initializeEncryptionKey();
		this._encryptionKey = key;
		return key;
	}

	async encrypt(value: string): Promise<string> {
		this.logService.trace('[BrowserEncryptionService] Encrypting value');

		try {
			const encoder = new TextEncoder();
			const data = encoder.encode(value);
			const key = await this.getEncryptionKey();
			const iv = mainWindow.crypto.getRandomValues(new Uint8Array(12));
			const encryptedBuffer = await mainWindow.crypto.subtle.encrypt(
				{ name: 'AES-GCM', iv },
				key,
				data
			);

			const encryptedArray = new Uint8Array(encryptedBuffer);
			const result = JSON.stringify({
				data: Array.from(encryptedArray),
				iv: Array.from(iv)
			});

			this.logService.trace('[BrowserEncryptionService] Encrypted value');
			return result;
		} catch (e) {
			this.logService.error('[BrowserEncryptionService] Error encrypting value:', e);
			throw e;
		}
	}

	async decrypt(value: string): Promise<string> {
		this.logService.trace('[BrowserEncryptionService] Decrypting value');

		try {
			const { data, iv } = JSON.parse(value);
			if (!data || !iv) {
				throw new Error('[BrowserEncryptionService] Invalid encrypted value');
			}

			const key = await this.getEncryptionKey();
			const ivArray = new Uint8Array(iv);
			const dataArray = new Uint8Array(data);

			const decryptedBuffer = await mainWindow.crypto.subtle.decrypt(
				{ name: 'AES-GCM', iv: ivArray },
				key,
				dataArray
			);

			const decoder = new TextDecoder();
			const decrypted = decoder.decode(decryptedBuffer);

			this.logService.trace('[BrowserEncryptionService] Decrypted value');
			return decrypted;
		} catch (e) {
			this.logService.error('[BrowserEncryptionService] Error decrypting value:', e);
			throw e;
		}
	}

	async isEncryptionAvailable(): Promise<boolean> {
		const available = !!(mainWindow?.crypto?.subtle);
		this.logService.trace('[BrowserEncryptionService] Encryption is available:', available);
		return available;
	}

	getKeyStorageProvider(): Promise<KnownStorageProvider> {
		this.logService.trace('[BrowserEncryptionService] Getting key storage provider:', KnownStorageProvider.basicText);
		return Promise.resolve(KnownStorageProvider.basicText);
	}

	// This function exists to satisfy the IEncryptionService interface,
	// but it is not valid in the browser as there is not a backup encryption method
	setUsePlainTextEncryption(): Promise<void> {
		this.logService.trace('[BrowserEncryptionService] Setting use plain text encryption is not valid in the browser');
		return Promise.resolve(undefined);
	}
}

registerSingleton(IEncryptionService, BrowserEncryptionService, InstantiationType.Delayed);
