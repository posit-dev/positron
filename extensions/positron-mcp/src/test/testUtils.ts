/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Request, Response, NextFunction } from 'express';
import type * as vscode from 'vscode';

/**
 * Cast a partial object to its full type for tests. The same helper
 * positron-assistant's tests use: a test only fills the members the code under
 * test actually touches.
 */
export function mock<T>(obj: Partial<T>): T {
	return obj as T;
}

/**
 * A minimal ExtensionContext sufficient to construct McpServer /
 * MinimalSecurityMiddleware. Only `workspaceState` is touched (by the consent
 * manager), and only when a code-execution consent path runs.
 */
export function fakeExtensionContext(): vscode.ExtensionContext {
	return mock<vscode.ExtensionContext>({
		subscriptions: [],
		workspaceState: mock<vscode.Memento>({
			get: <T>(_key: string, defaultValue?: T) => defaultValue as T,
			update: async () => { /* no-op */ },
		}),
	});
}

/** What an Express middleware did when invoked: its response and whether it called next(). */
export interface MiddlewareCall {
	statusCode: number;
	headers: Record<string, string>;
	body: unknown;
	nextCalled: boolean;
}

/**
 * Invoke an Express-style middleware with a fake request/response and report
 * what it did. The fake response records `status()`, `json()`, and
 * `setHeader()`; `next()` flips `nextCalled`. No HTTP server is involved.
 */
export function callMiddleware(
	middleware: (req: Request, res: Response, next: NextFunction) => void,
	headers: Record<string, string | undefined>,
): MiddlewareCall {
	const result: MiddlewareCall = { statusCode: 200, headers: {}, body: undefined, nextCalled: false };

	const res: Partial<Response> = {
		status(code: number) { result.statusCode = code; return res as Response; },
		json(payload: unknown) { result.body = payload; return res as Response; },
		setHeader(key: string, value: string | number | readonly string[]) {
			result.headers[key] = String(value);
			return res as Response;
		},
	};

	const req = mock<Request>({ headers: headers as Request['headers'], method: 'POST', path: '/' });
	const next: NextFunction = () => { result.nextCalled = true; };

	middleware(req, res as Response, next);
	return result;
}
