/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { RRuntime } from './runtime';

/**
 * Manages all the registered R runtimes. We keep our own references to each
 * runtime in a singleton instance of this class so that we can invoke
 * methods/check status directly, without going through Positron's API.
 */
export class RRuntimeManager {
	/// Singleton instance
	private static _instance: RRuntimeManager;

	/// Map of runtime IDs to RRuntime instances
	private _runtimes: Map<string, RRuntime> = new Map();

	/// The last binpath that was used
	private _lastBinpath = '';

	/// Constructor; private since we only want one of these
	private constructor() { }

	/**
	 * Accessor for the singleton instance; creates it if it doesn't exist.
	 */
	static get instance(): RRuntimeManager {
		if (!RRuntimeManager._instance) {
			RRuntimeManager._instance = new RRuntimeManager();
		}
		return RRuntimeManager._instance;
	}

	/**
	 * Gets the runtime with the given ID, if it's registered.
	 *
	 * @param id The ID of the runtime to get
	 * @returns The runtime. Throws an error if the runtime doesn't exist.
	 */
	getRuntime(id: string): RRuntime {
		const runtime = this._runtimes.get(id);
		if (!runtime) {
			throw new Error(`Runtime ${id} not found.`);
		}
		return runtime;
	}

	/**
	 * Registers a runtime with the manager. Throws an error if a runtime with
	 * the same ID is already registered.
	 *
	 * @param id The runtime's ID
	 * @param runtime The runtime.
	 */
	setRuntime(id: string, runtime: RRuntime): void {
		if (this._runtimes.has(id)) {
			throw new Error(`Runtime ${id} already registered.`);
		}
		this._runtimes.set(id, runtime);
	}

	/**
	 * Checks to see whether a runtime with the given ID is registered.
	 *
	 * @param id The ID of the runtime to check
	 * @returns Whether the runtime with the given ID is registered.
	 */
	hasRuntime(id: string): boolean {
		return this._runtimes.has(id);
	}

	/**
	 * Sets the last observed R binary path.
	 *
	 * @param path The path to the R binary
	 */
	setLastBinpath(path: string) {
		this._lastBinpath = path;
	}

	/**
	 * Returns the last observed R binary path.
	 *
	 * @returns Whether we have a last observed R binary path.
	 */
	hasLastBinpath(): boolean {
		return this._lastBinpath !== '';
	}

	/**
	 * Returns the last observed R binary path.
	 */
	getLastBinpath(): string {
		return this._lastBinpath;
	}
}

