/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IEphemeralStateService } from '../../../../platform/ephemeralState/common/ephemeralState.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IPositronSessionMetadata, IPositronSessionService } from './positronSession.js';

const SESSION_STORAGE_KEY = 'positron.session.metadata';

export class PositronSessionService extends Disposable implements IPositronSessionService {

	// Needed for dependency injection
	_serviceBrand: undefined;

	// The current session metadata, if known
	private _sessionMetadata: IPositronSessionMetadata | undefined;

	_ephemeralStateKey: string;

	constructor(
		@IStorageService private readonly _storageService: IStorageService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@IEphemeralStateService private readonly _ephemeralStateService: IEphemeralStateService,
		@ILogService private readonly _logService: ILogService) {
		super();

		// Derive the ephemeral state key from the workspace ID
		this._ephemeralStateKey = `positron.session.${this._workspaceContextService.getWorkspace().id}`;

	}

	async getSessionOrdinal(): Promise<number> {
		return (await this.getSessionMetadata()).ordinal;
	}

	async getSessionMetadata(): Promise<IPositronSessionMetadata> {
		// If we already have the session metadata, return the ordinal
		// directly.
		if (this._sessionMetadata) {
			return this._sessionMetadata;
		}

		// Check to see if the session ordinal is stored in the ephemeral state
		const metadata = await this._ephemeralStateService.getItem<IPositronSessionMetadata>(this._ephemeralStateKey);

		// If we found the session metadata, store it and return
		if (metadata) {
			this._sessionMetadata = metadata;
			return metadata;
		}

		// Check to see if this workspace has stored session metadata.
		const persistedSessions = this._storageService.get(SESSION_STORAGE_KEY, StorageScope.WORKSPACE);
		if (persistedSessions) {
			try {
				const sessions = JSON.parse(persistedSessions);
				if (Array.isArray(sessions) && sessions.length > 0) {
					// Create a new session metadata object
					this._sessionMetadata = {
						ordinal: sessions[sessions.length - 1].ordinal + 1,
						created: Date.now()
					};
					// Add it to durable storage
					sessions.push(this._sessionMetadata);
					this._storageService.store(SESSION_STORAGE_KEY, JSON.stringify(sessions), StorageScope.WORKSPACE, StorageTarget.MACHINE);
				}
			} catch (e) {
				this._logService.warn('Error parsing session metadata', e);
			}
		}

		// If we still don't have session metadata, create a new session
		if (!this._sessionMetadata) {
			this._sessionMetadata = this.newSessionMetadata();

			// Store it in durable storage
			const sessions = [this._sessionMetadata];
			this._storageService.store(SESSION_STORAGE_KEY, JSON.stringify(sessions), StorageScope.WORKSPACE, StorageTarget.MACHINE);
		}

		// Save the metadata in the ephemeral state
		this._ephemeralStateService.setItem(this._ephemeralStateKey, this._sessionMetadata);

		// Return the session metadata
		return this._sessionMetadata;
	}

	private newSessionMetadata(): IPositronSessionMetadata {
		return {
			ordinal: 0,
			created: Date.now()
		};
	}
}

registerSingleton(IPositronSessionService, PositronSessionService, InstantiationType.Delayed);
