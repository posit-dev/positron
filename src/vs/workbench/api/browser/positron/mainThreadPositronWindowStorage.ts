/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IEphemeralStateService } from '../../../../platform/ephemeralState/common/ephemeralState.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { MainPositronContext, MainThreadPositronWindowStorageShape } from '../../common/positron/extHost.positron.protocol.js';
import { extHostNamedCustomer, IExtHostContext } from '../../../services/extensions/common/extHostCustomers.js';

@extHostNamedCustomer(MainPositronContext.MainThreadPositronWindowStorage)
export class MainThreadPositronWindowStorage implements MainThreadPositronWindowStorageShape {

	private readonly _workspaceId: string;

	constructor(
		_extHostContext: IExtHostContext,
		@IEphemeralStateService private readonly _ephemeralStateService: IEphemeralStateService,
		@IWorkspaceContextService workspaceContextService: IWorkspaceContextService,
	) {
		this._workspaceId = workspaceContextService.getWorkspace().id;
	}

	/**
	 * Build the ephemeral-state key for a given extension.
	 *
	 * Scoped by workspace ID so that each workspace gets its own isolated
	 * namespace. This is necessary because on Positron Server ephemeral
	 * storage is shared among workspaces. Without it, switching workspaces
	 * in the same browser tab would leak state across them.
	 *
	 * Follows the same lifecycle pattern used by console sessions
	 * (see `RuntimeStartupService.getEphemeralWorkspaceSessionsKey`):
	 * storage lives in `EphemeralStateService`, an in-memory store that
	 * is discarded when the process exits. On desktop Positron this is
	 * equivalent to the window closing. On Positron Server the process
	 * outlives individual browser tabs, so entries for a closed tab are
	 * orphaned until the server shuts down or restarts, which matches
	 * the existing console-session behaviour.
	 */
	private _storageKey(extensionId: string): string {
		return `windowStorage.${this._workspaceId}.${extensionId}`;
	}

	async $initializeWindowStorage(extensionId: string): Promise<string | undefined> {
		return this._ephemeralStateService.getItem<string>(this._storageKey(extensionId));
	}

	async $setWindowValue(extensionId: string, value: string): Promise<void> {
		return this._ephemeralStateService.setItem(this._storageKey(extensionId), value);
	}

	async $deleteWindowValue(extensionId: string): Promise<void> {
		return this._ephemeralStateService.removeItem(this._storageKey(extensionId));
	}

	dispose(): void { }
}
