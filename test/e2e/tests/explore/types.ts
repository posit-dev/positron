/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

export interface ActionRequest {
	action: string;
	params: Record<string, any>;
	/** Optional human-readable title for the Playwright report step label. */
	title?: string;
}

export interface PomRequest {
	/** Workbench POM name, e.g. "sessions", "notebooksPositron". Dot-paths supported: "dataExplorer" */
	pom: string;
	/** Method name on the POM class, e.g. "start", "getCellCount" */
	method: string;
	/** Positional arguments for the method call (default []) */
	args?: unknown[];
	/** Editor group index for scopedTo() -- only applies to POMs that support scoping */
	scope?: number;
	/** Optional human-readable title for the Playwright report step label */
	title?: string;
}

export interface ActionResult {
	success: boolean;
	result?: string;
	error?: string;
	state: AppState;
	duration: number;
}

/** A single step in a batch request -- either a POM call or an action call. */
export interface BatchStep {
	/** "pom" for POM reflection calls, "action" for catalog actions. */
	type: 'pom' | 'action';
	/** For type "pom": the POM request fields. */
	pom?: string;
	method?: string;
	args?: unknown[];
	scope?: number;
	/** For type "action": the action name and params. */
	action?: string;
	params?: Record<string, any>;
	/** Human-readable label for the Playwright report. */
	title?: string;
}

export interface BatchRequest {
	steps: BatchStep[];
	/** Human-readable label for the batch group in the Playwright report. */
	title?: string;
}

export interface BatchResult {
	/** Steps that completed successfully (in order). */
	completed: ActionResult[];
	/** The step that failed, if any. */
	failed?: ActionResult & { index: number };
	/** Number of steps skipped after the failure. */
	skipped: number;
	/** Final observed state (after last executed step). */
	state: AppState;
}

export interface AppState {
	activeEditor?: string;
	consoleLinesCount?: number;
	lastConsoleOutput?: string;
	variableCount?: number;
	plotVisible?: boolean;
	notifications?: string[];
}
