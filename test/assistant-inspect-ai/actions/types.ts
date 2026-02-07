/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Application } from '../../../test/e2e/infra';

/**
 * Context passed to action functions, providing access to test infrastructure.
 */
export interface ActionContext {
	app: Application;
	sessions: {
		python: { id: string };
		r: { id: string };
		select: (id: string) => Promise<void>;
		restart: (id: string, options?: { clearConsole?: boolean }) => Promise<void>;
	};
	hotKeys: {
		closeAllEditors: () => Promise<void>;
	};
	cleanup: {
		discardAllChanges: () => Promise<void>;
	};
	settings: {
		set: (settings: Record<string, unknown>, options?: { reload?: boolean | 'web'; waitMs?: number; waitForReady?: boolean; keepOpen?: boolean }) => Promise<void>;
	};
}

/**
 * Optional action functions that a sample can export.
 * All functions are optional - only define what you need.
 */
export interface SampleActions {
	/** Runs before the question is asked */
	setup?: (ctx: ActionContext) => Promise<void>;
	/** Runs after the question is asked but before getting the response */
	postQuestion?: (ctx: ActionContext) => Promise<void>;
	/** Runs after the response is captured */
	cleanup?: (ctx: ActionContext) => Promise<void>;
}
