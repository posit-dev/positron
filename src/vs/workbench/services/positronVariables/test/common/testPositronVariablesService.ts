/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../../base/common/event.js';
import { Disposable, DisposableMap } from '../../../../../base/common/lifecycle.js';
import { IPositronVariablesService } from '../../common/interfaces/positronVariablesService.js';
import { IPositronVariablesInstance } from '../../common/interfaces/positronVariablesInstance.js';
import { ILanguageRuntimeSession } from '../../../runtimeSession/common/runtimeSessionService.js';
import { TestPositronVariablesInstance } from './testPositronVariablesInstance.js';

/**
 * TestPositronVariablesService class.
 *
 * This is a test implementation of the IPositronVariablesService for use in tests.
 */
export class TestPositronVariablesService extends Disposable implements IPositronVariablesService {
	//#region Private Properties

	/**
	 * Gets a map of the Positron variables instances by session ID.
	 */
	private readonly _positronVariablesInstancesBySessionId =
		this._register(new DisposableMap<string, TestPositronVariablesInstance>());

	/**
	 * Gets or sets the active Positron variables instance.
	 */
	private _activePositronVariablesInstance?: IPositronVariablesInstance;

	/**
	 * The onDidStartPositronVariablesInstance event emitter.
	 */
	private readonly _onDidStartPositronVariablesInstanceEmitter =
		this._register(new Emitter<IPositronVariablesInstance>());

	/**
	 * The onDidStopPositronVariablesInstance event emitter.
	 */
	private readonly _onDidStopPositronVariablesInstanceEmitter =
		this._register(new Emitter<IPositronVariablesInstance>());

	/**
	 * The onDidChangeActivePositronVariablesInstance event emitter.
	 */
	private readonly _onDidChangeActivePositronVariablesInstanceEmitter =
		this._register(new Emitter<IPositronVariablesInstance | undefined>());

	//#endregion Private Properties

	//#region Constructor

	/**
	 * Constructor.
	 */
	constructor() {
		super();
	}

	//#endregion Constructor

	//#region IPositronVariablesService Implementation

	/**
	 * Needed for service branding in dependency injector.
	 */
	readonly _serviceBrand: undefined;

	/**
	 * Gets the Positron variables instances.
	 */
	get positronVariablesInstances(): IPositronVariablesInstance[] {
		return Array.from(this._positronVariablesInstancesBySessionId.values());
	}

	/**
	 * Gets the active Positron variables instance.
	 */
	get activePositronVariablesInstance(): IPositronVariablesInstance | undefined {
		return this._activePositronVariablesInstance;
	}

	/**
	 * The onDidStartPositronVariablesInstance event.
	 */
	readonly onDidStartPositronVariablesInstance = this._onDidStartPositronVariablesInstanceEmitter.event;

	/**
	 * The onDidStopPositronVariablesInstance event.
	 */
	readonly onDidStopPositronVariablesInstance = this._onDidStopPositronVariablesInstanceEmitter.event;

	/**
	 * The onDidChangeActivePositronVariablesInstance event.
	 */
	readonly onDidChangeActivePositronVariablesInstance = this._onDidChangeActivePositronVariablesInstanceEmitter.event;

	/**
	 * Sets the active variables instance to the one with the given session ID.
	 *
	 * @param sessionId The session ID.
	 */
	setActivePositronVariablesSession(sessionId: string): void {
		const positronVariablesInstance = this._positronVariablesInstancesBySessionId.get(sessionId);
		if (positronVariablesInstance) {
			this._setActivePositronVariablesInstance(positronVariablesInstance);
		}
	}

	/**
	 * Placeholder that gets called to "initialize" the PositronVariablesService.
	 */
	initialize(): void {
		// No-op for test implementation
	}

	/**
	 * Sets whether the Variables pane is visible.
	 * This is a no-op in the test implementation since visibility
	 * doesn't affect test behavior.
	 *
	 * @param visible Whether the Variables pane is visible.
	 */
	setViewVisible(visible: boolean): void {
		// No-op for test implementation
	}

	//#endregion IPositronVariablesService Implementation

	//#region Private Methods

	/**
	 * Sets the active Positron variables instance.
	 * @param positronVariablesInstance The Positron variables instance.
	 */
	private _setActivePositronVariablesInstance(positronVariablesInstance: IPositronVariablesInstance): void {
		if (this._activePositronVariablesInstance !== positronVariablesInstance) {
			this._activePositronVariablesInstance = positronVariablesInstance;
			this._onDidChangeActivePositronVariablesInstanceEmitter.fire(positronVariablesInstance);
		}
	}

	//#endregion Private Methods

	//#region Test Helper Methods

	/**
	 * Creates and registers a new TestPositronVariablesInstance for the given session.
	 * @param session The language runtime session.
	 * @param setActive Whether to set the new instance as active.
	 * @returns The created TestPositronVariablesInstance.
	 */
	createPositronVariablesInstance(session: ILanguageRuntimeSession, setActive: boolean = false): TestPositronVariablesInstance {
		// Create the instance
		const positronVariablesInstance = this._register(new TestPositronVariablesInstance(session));

		// Add it to the map
		this._positronVariablesInstancesBySessionId.set(session.sessionId, positronVariablesInstance);

		// Fire the event
		this._onDidStartPositronVariablesInstanceEmitter.fire(positronVariablesInstance);

		// Set as active if requested
		if (setActive) {
			this._setActivePositronVariablesInstance(positronVariablesInstance);
		}

		return positronVariablesInstance;
	}

	/**
	 * Gets a TestPositronVariablesInstance by session ID.
	 * @param sessionId The session ID.
	 * @returns The TestPositronVariablesInstance or undefined if not found.
	 */
	getInstanceBySessionId(sessionId: string): TestPositronVariablesInstance | undefined {
		return this._positronVariablesInstancesBySessionId.get(sessionId);
	}

	/**
	 * Removes a Positron variables instance.
	 * @param sessionId The session ID.
	 */
	removeInstance(sessionId: string): void {
		const instance = this._positronVariablesInstancesBySessionId.get(sessionId);
		if (instance) {
			this._positronVariablesInstancesBySessionId.deleteAndDispose(sessionId);
			this._onDidStopPositronVariablesInstanceEmitter.fire(instance);

			// If this was the active instance, clear it
			if (this._activePositronVariablesInstance === instance) {
				this._activePositronVariablesInstance = undefined;
				this._onDidChangeActivePositronVariablesInstanceEmitter.fire(undefined);
			}
		}
	}

	//#endregion Test Helper Methods
}
