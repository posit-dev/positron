/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../../base/common/event.js';
import { IDisposable } from '../../../../../base/common/lifecycle.js';
import { ILanguageRuntimeMetadata, IRuntimeManager } from '../../../languageRuntime/common/languageRuntimeService.js';
import { IRuntimeAutoStartEvent, IRuntimeStartupService, ISessionRestoreFailedEvent, SerializedSessionMetadata } from '../../common/runtimeStartupService.js';

/**
 * Test implementation of IRuntimeStartupService for use in tests.
 */
export class TestRuntimeStartupService implements IRuntimeStartupService {
	declare readonly _serviceBrand: undefined;

	private readonly _onWillAutoStartRuntimeEmitter = new Emitter<IRuntimeAutoStartEvent>();
	private readonly _onSessionRestoreFailureEmitter = new Emitter<ISessionRestoreFailedEvent>();

	private _preferredRuntimes = new Map<string, ILanguageRuntimeMetadata>();
	private _affiliatedRuntimes = new Map<string, ILanguageRuntimeMetadata>();
	private _restoredSessions: SerializedSessionMetadata[] = [];
	private _runtimeManagers: IRuntimeManager[] = [];

	constructor() { }

	/**
	 * {@inheritDoc}
	 */
	public get onWillAutoStartRuntime(): Event<IRuntimeAutoStartEvent> {
		return this._onWillAutoStartRuntimeEmitter.event;
	}

	/**
	 * {@inheritDoc}
	 */
	public get onSessionRestoreFailure(): Event<ISessionRestoreFailedEvent> {
		return this._onSessionRestoreFailureEmitter.event;
	}

	/**
	 * {@inheritDoc}
	 */
	public getPreferredRuntime(languageId: string): ILanguageRuntimeMetadata | undefined {
		return this._preferredRuntimes.get(languageId);
	}

	/**
	 * Sets the preferred runtime for a language.
	 *
	 * @param languageId The language identifier.
	 * @param runtime The preferred runtime metadata.
	 */
	public setPreferredRuntime(languageId: string, runtime: ILanguageRuntimeMetadata): void {
		this._preferredRuntimes.set(languageId, runtime);
	}

	/**
	 * {@inheritDoc}
	 */
	public hasAffiliatedRuntime(): boolean {
		return this._affiliatedRuntimes.size > 0;
	}

	/**
	 * {@inheritDoc}
	 */
	public getAffiliatedRuntimeMetadata(languageId: string): ILanguageRuntimeMetadata | undefined {
		return this._affiliatedRuntimes.get(languageId);
	}

	/**
	 * {@inheritDoc}
	 */
	public getAffiliatedRuntimes(): Array<ILanguageRuntimeMetadata> {
		return Array.from(this._affiliatedRuntimes.values());
	}

	/**
	 * Set an affiliated runtime.
	 *
	 * @param languageId The language identifier.
	 * @param runtime The runtime metadata to affiliate.
	 */
	public setAffiliatedRuntime(languageId: string, runtime: ILanguageRuntimeMetadata): void {
		this._affiliatedRuntimes.set(languageId, runtime);
	}

	/**
	 * {@inheritDoc}
	 */
	public clearAffiliatedRuntime(languageId: string): void {
		this._affiliatedRuntimes.delete(languageId);
	}

	/**
	 * Triggers the onWillAutoStartRuntime event.
	 *
	 * @param runtime The runtime that will be automatically started.
	 * @param newSession Whether this is a new session.
	 */
	public fireWillAutoStartRuntime(runtime: ILanguageRuntimeMetadata, newSession: boolean): void {
		this._onWillAutoStartRuntimeEmitter.fire({ runtime, newSession });
	}

	/**
	 * {@inheritDoc}
	 */
	public completeDiscovery(id: number): void {
		// No-op in test implementation
	}

	/**
	 * {@inheritDoc}
	 */
	public async getRestoredSessions(): Promise<SerializedSessionMetadata[]> {
		return this._restoredSessions;
	}

	/**
	 * Sets the restored sessions for testing.
	 *
	 * @param sessions The sessions to set as restored.
	 */
	public setRestoredSessions(sessions: SerializedSessionMetadata[]): void {
		this._restoredSessions = sessions;
	}

	/**
	 * Triggers the onSessionRestoreFailure event.
	 *
	 * @param sessionId The ID of the session that failed to restore.
	 * @param error The error that occurred during restoration.
	 */
	public fireSessionRestoreFailure(sessionId: string, error: Error): void {
		this._onSessionRestoreFailureEmitter.fire({ sessionId, error });
	}

	/**
	 * {@inheritDoc}
	 */
	public registerRuntimeManager(manager: IRuntimeManager): IDisposable {
		this._runtimeManagers.push(manager);
		return {
			dispose: () => {
				const index = this._runtimeManagers.indexOf(manager);
				if (index !== -1) {
					this._runtimeManagers.splice(index, 1);
				}
			}
		};
	}

	/**
	 * Gets the registered runtime managers.
	 */
	public getRegisteredRuntimeManagers(): IRuntimeManager[] {
		return [...this._runtimeManagers];
	}
}
