/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { IExtensionStorageService } from '../../../../platform/extensionManagement/common/extensionStorage.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ISecretStorageService } from '../../../../platform/secrets/common/secrets.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IAiProviderService } from '../../../services/positronAiProvider/common/aiProviderService.js';
import { extensionSecretStorageKey } from '../../../api/common/extensionSecretStorageKey.js';
import {
	LEGACY_AUTH_EXTENSION_ID,
	LegacyStoredAccount,
	planLegacyCredentialCopy,
} from '../common/legacyCredentialCopy.js';

const DONE_KEY = 'positronAssistant.legacyCredentialCopy.done';
const DEFAULT_POSITAI_SCOPE = 'prism';

/**
 * Copies the credentials `positron.authentication` stored for the providers
 * that moved to Assistant into Assistant's secret store, once per profile and
 * never over a record Assistant already holds. Reads another extension's
 * storage keys directly; a migration step, to be removed a fixed number of
 * releases after it ships.
 */
export class LegacyCredentialCopyContribution extends Disposable implements IWorkbenchContribution {
	readonly whenDone: Promise<void>;

	constructor(
		@ISecretStorageService private readonly _secrets: ISecretStorageService,
		@IExtensionStorageService private readonly _extensionStorage: IExtensionStorageService,
		@IStorageService private readonly _storage: IStorageService,
		@IAiProviderService private readonly _aiProviders: IAiProviderService,
		@ILogService private readonly _log: ILogService,
	) {
		super();
		this.whenDone = this._run();
	}

	private async _run(): Promise<void> {
		if (this._storage.getBoolean(DONE_KEY, StorageScope.PROFILE, false)) {
			return;
		}
		try {
			await this._aiProviders.whenInitialized;
			if (this._aiProviders.status !== 'ready') {
				this._log.warn('[legacy-credential-copy] provider catalog not ready; will retry next launch');
				return;
			}
			const state = this._extensionStorage.getExtensionState(LEGACY_AUTH_EXTENSION_ID, true) ?? {};
			let indexedAccounts = 0;
			let readableSecrets = 0;
			const writes = await planLegacyCredentialCopy({
				accounts: legacyId => {
					const accounts = (state[`auth.accounts.${legacyId}`] as LegacyStoredAccount[] | undefined) ?? [];
					indexedAccounts += accounts.length;
					return accounts;
				},
				secret: async key => {
					const value = await this._secrets.get(extensionSecretStorageKey(LEGACY_AUTH_EXTENSION_ID, key));
					if (value !== undefined) {
						readableSecrets++;
					}
					return value;
				},
			}, {
				customEntryIds: this._aiProviders.getProviders().filter(p => p.custom === true).map(p => p.id),
				positaiScope: this._aiProviders.getProvider('positai')?.connection.positaiLogin?.scope ?? DEFAULT_POSITAI_SCOPE,
				generation: generateUuid,
				log: (level, message) => this._log[level](`[legacy-credential-copy] ${message}`),
			});
			if (indexedAccounts > 0 && readableSecrets === 0) {
				this._log.warn('[legacy-credential-copy] accounts are indexed but no secret was readable; will retry next launch');
				return;
			}
			let copied = 0;
			for (const write of writes) {
				if (await this._secrets.get(write.key) !== undefined) {
					continue;
				}
				await this._secrets.set(write.key, write.value);
				copied++;
			}
			this._storage.store(DONE_KEY, true, StorageScope.PROFILE, StorageTarget.MACHINE);
			this._log.info(`[legacy-credential-copy] copied ${copied} of ${writes.length} record(s) to Assistant; the rest already existed`);
		} catch (error) {
			this._log.error('[legacy-credential-copy] failed; will retry next launch', error);
		}
	}
}
