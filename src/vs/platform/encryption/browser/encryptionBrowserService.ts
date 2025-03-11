/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { mainWindow } from '../../../base/browser/window.js';
import { IEncryptionService, KnownStorageProvider } from '../common/encryptionService.js';
import { ILogService } from '../../log/common/log.js';
import { InstantiationType, registerSingleton } from '../../instantiation/common/extensions.js';
import { IStorageService, StorageScope, StorageTarget } from '../../storage/common/storage.js';

/**
 * Browser-specific encryption service that uses the Web Crypto API
 */
export class EncryptionBrowserService implements IEncryptionService {
	_serviceBrand: undefined;

	private _encryptionKey: CryptoKey | undefined;
	private _keyInitPromise: Promise<CryptoKey> | undefined;
	private readonly _storageKeyName = 'browser.encryptionKeyWrapped';

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@ILogService private readonly logService: ILogService) {
		this.logService.info('[EncryptionBrowserService] Initializing browser encryption service');
		this._keyInitPromise = this.initializeEncryptionKey();
	}

	private async initializeEncryptionKey(): Promise<CryptoKey> {
		// TO DO: Swap some info logging for trace logging
		this.logService.info('[EncryptionBrowserService] Initializing encryption key...');
		try {
			const storedKeyData = this.storageService.get(this._storageKeyName, StorageScope.APPLICATION);

			if (storedKeyData && storedKeyData !== '{}') {
				this.logService.info('[EncryptionBrowserService] Found stored key data.');
				this._encryptionKey = await mainWindow.crypto.subtle.importKey(
					'jwk',
					JSON.parse(storedKeyData),
					{ name: 'AES-GCM' },
					true,
					['encrypt', 'decrypt']
				);
				return this._encryptionKey;
			}
			this.logService.info('[EncryptionBrowserService] No stored key data found.');
			return await this.generateAndStoreEncryptionKey();
		} catch (error) {
			this.logService.error('[EncryptionBrowserService] Error initializing encryption key:', error);
			return this.generateAndStoreEncryptionKey();
		}
	}

	private async generateAndStoreEncryptionKey(): Promise<CryptoKey> {
		this.logService.info('[EncryptionBrowserService] Generating encryption key...');
		try {
			const key = await mainWindow.crypto.subtle.generateKey(
				{ name: 'AES-GCM', length: 256 },
				true,
				['encrypt', 'decrypt']
			);

			const exportedKey = await mainWindow.crypto.subtle.exportKey('jwk', key);
			const keyString = JSON.stringify(exportedKey);
			this.storageService.store(this._storageKeyName, keyString, StorageScope.APPLICATION, StorageTarget.MACHINE);

			this._encryptionKey = key;
			this.logService.info('[EncryptionBrowserService] Generated encryption key.');
			return this._encryptionKey;
		} catch (error) {
			this.logService.error('[EncryptionBrowserService] Error generating encryption key:', error);
			throw error;
		}
	}

	private async getEncryptionKey(): Promise<CryptoKey> {
		if (this._encryptionKey) {
			return this._encryptionKey;
		}

		if (!this._keyInitPromise) {
			this._keyInitPromise = this.initializeEncryptionKey();
		}

		return this._keyInitPromise;
	}

	async encrypt(value: string): Promise<string> {
		this.logService.info('[EncryptionBrowserService] Encrypting value...');

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

			this.logService.info('[EncryptionBrowserService] Encrypted value.');
			return result;
		} catch (e) {
			this.logService.error(e);
			throw e;
		}
	}

	async decrypt(value: string): Promise<string> {
		this.logService.info('[EncryptionBrowserService] Decrypting value...');

		try {
			const { data, iv } = JSON.parse(value);
			if (!data || !iv) {
				throw new Error('[EncryptionBrowserService Invalid encrypted value');
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

			this.logService.info('[EncryptionBrowserService] Decrypted value.');
			return decrypted;
		} catch (e) {
			this.logService.error('[EncryptionBrowserService] Error decrypting value:', e);
			throw e;
		}
	}

	async isEncryptionAvailable(): Promise<boolean> {
		const available = !!(mainWindow?.crypto?.subtle);
		this.logService.info('[EncryptionBrowserService] Encryption is available:', available);
		return available;
	}

	getKeyStorageProvider(): Promise<KnownStorageProvider> {
		this.logService.info('[EncryptionBrowserService] Getting key storage provider:', KnownStorageProvider.basicText);
		return Promise.resolve(KnownStorageProvider.basicText);
	}

	setUsePlainTextEncryption(): Promise<void> {
		this.logService.info('[EncryptionBrowserService] Setting use plain text encryption');
		return Promise.resolve(undefined);
	}
}

registerSingleton(IEncryptionService, EncryptionBrowserService, InstantiationType.Delayed);
