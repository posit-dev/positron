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
	/** Per-step timeout override in ms. Falls back to RunPlanRequest.stepTimeout or 10000. */
	timeout?: number;
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

export interface RunPlanRequest {
	/** Descriptive label for the test group in the Playwright report. */
	title: string;
	/** Ordered steps to execute. */
	steps: BatchStep[];
	/** Run state reset before executing steps (set true on retries). */
	resetBefore?: boolean;
	/** Default timeout in ms for all steps (default 10000). */
	stepTimeout?: number;
}

export interface RunPlanStepResult {
	/** Human-readable step label. */
	title: string;
	success: boolean;
	error?: string;
	duration: number;
}

export interface RunPlanResult {
	/** Number of steps that passed. */
	passed: number;
	/** Number of steps that failed (0 or 1 due to fail-fast). */
	failed: number;
	/** Per-step results in execution order. */
	steps: RunPlanStepResult[];
	/** Number of steps skipped after failure. */
	skipped?: number;
	/** Total wall-clock time including reset. */
	totalDuration: number;
	/** Observed application state after last executed step. */
	state: AppState;
	/** Cleanup actions taken if resetBefore was true. */
	resetActions?: string[];
}

export interface AppState {
	activeEditor?: string;
	consoleLinesCount?: number;
	lastConsoleOutput?: string;
	variableCount?: number;
	plotVisible?: boolean;
	/** Up to 20 variable names from the active Variables pane. */
	variableNames?: string[];
	/** Number of active sessions. */
	sessionCount?: number;
	/** Active session label and status, e.g. "Python: idle". */
	activeSession?: string;
	/** Visible notification/toast messages. */
	notifications?: string[];
	/** Tab labels of all open editors. */
	openTabs?: string[];
	/** Which panel has focus: "console", "terminal", "editor", etc. */
	focusedPanel?: string;
}
