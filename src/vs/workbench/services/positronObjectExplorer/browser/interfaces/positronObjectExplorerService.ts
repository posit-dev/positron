/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { IPositronObjectExplorerInstance } from './positronObjectExplorerInstance.js';

export const IPositronObjectExplorerService = createDecorator<IPositronObjectExplorerService>('positronObjectExplorerService');

/**
 * IPositronObjectExplorerService interface.
 */
export interface IPositronObjectExplorerService {
	readonly _serviceBrand: undefined;

	/**
	 * Fires when an instance is registered.
	 */
	readonly onDidRegisterInstance: Event<IPositronObjectExplorerInstance>;

	/**
	 * Gets the instance with the specified identifier.
	 * @param identifier The instance identifier.
	 */
	getInstance(identifier: string): IPositronObjectExplorerInstance | undefined;

	/**
	 * Gets an instance by identifier, waiting for it to be registered if needed.
	 * @param identifier The instance identifier.
	 * @param timeoutMs Maximum time to wait in milliseconds.
	 * @returns The instance, or undefined if it was not registered in time.
	 */
	getInstanceAsync(identifier: string, timeoutMs?: number): Promise<IPositronObjectExplorerInstance | undefined>;

	/**
	 * Gets the instance opened for the specified variable.
	 * @param variableId The variable identifier.
	 */
	getInstanceForVar(variableId: string): IPositronObjectExplorerInstance | undefined;

	/**
	 * Associates a variable with an instance. The instance need not exist yet.
	 * @param instanceId The instance identifier.
	 * @param variableId The variable identifier.
	 */
	setInstanceForVar(instanceId: string, variableId: string): void;

	/**
	 * Gets the instance opened for the specified variable path within a session.
	 * @param sessionId The runtime session ID.
	 * @param variablePath The encoded variable path.
	 */
	getInstanceForVariablePath(sessionId: string, variablePath: string[]): IPositronObjectExplorerInstance | undefined;

	/**
	 * Disposes an instance whose editor closed, closing its comm. Inline instances are left alone,
	 * since the runtime owns their comms.
	 * @param identifier The instance identifier.
	 */
	closeInstance(identifier: string): void;

	/**
	 * Opens a JSON file in the Object Explorer, or activates the editor already showing it.
	 * @param uri The file.
	 */
	openWithJsonFile(uri: URI): Promise<void>;

	/**
	 * Reads a JSON file into an instance, unless one already shows it. The instance reloads when the
	 * file changes.
	 * @param uri The file.
	 * @returns The identifier of the instance.
	 * @throws If the file can't be read or parsed.
	 */
	loadJsonFile(uri: URI): Promise<string>;
}
