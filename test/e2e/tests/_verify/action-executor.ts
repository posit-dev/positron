/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from '@playwright/test';
import { Application } from '../../infra/application';
import { actionCatalog } from './action-catalog';
import { observeState } from './observer';
import { ActionRequest, ActionResult, BatchRequest, BatchResult, BatchStep, PomRequest, RunPlanRequest, RunPlanResult, RunPlanStepResult } from './types';
import { resetState } from './state-reset';

let stepCounter = 0;

/** Actions in the catalog that are Raw Playwright or escape hatches (not POM wrappers). */
const rawActions = new Set([
	'snapshot', 'clickText', 'clickRole', 'clickSelector', 'fill', 'press', 'type',
	'waitForText', 'waitForSelector', 'takeScreenshot', 'evaluate',
	'resizeWindow', 'getWindowSize',
]);

/** Create a promise that rejects after the given timeout. */
function createStepTimeout(ms: number): Promise<never> {
	return new Promise((_, reject) =>
		setTimeout(() => reject(new Error(`Step timed out after ${ms}ms`)), ms)
	);
}

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

/** Stringify an arbitrary POM return value into a human-readable string. */
function stringify(value: unknown): string {
	if (value === undefined || value === null) { return 'ok'; }
	if (typeof value === 'string') { return value; }
	if (typeof value === 'number' || typeof value === 'boolean') { return String(value); }
	if (Array.isArray(value)) { return JSON.stringify(value); }
	try { return JSON.stringify(value); } catch { return String(value); }
}

/** Extract parameter signature from a function's source (best-effort). */
function extractSignature(fn: Function): string {
	const src = fn.toString();
	// Match the parameter list: "async foo(a, b, c)" or "(a, b) =>"
	const match = src.match(/^(?:async\s+)?(?:\w+\s*)?\(([^)]*)\)/);
	if (!match) { return ''; }
	const params = match[1].trim();
	return params || '';
}

/** List public methods on a class instance with their signatures. */
export function listMethodsWithSignatures(obj: any): string[] {
	const methods: string[] = [];
	const seen = new Set<string>();
	let proto = Object.getPrototypeOf(obj);
	while (proto && proto !== Object.prototype) {
		for (const key of Object.getOwnPropertyNames(proto)) {
			if (key !== 'constructor' && !key.startsWith('_') && typeof obj[key] === 'function' && !seen.has(key)) {
				seen.add(key);
				const sig = extractSignature(obj[key]);
				methods.push(sig ? `${key}(${sig})` : `${key}()`);
			}
		}
		proto = Object.getPrototypeOf(proto);
	}
	return methods.sort();
}

/** List available POM names on the workbench. */
export function listPoms(workbench: any): string[] {
	return Object.keys(workbench)
		.filter(k => {
			const v = workbench[k];
			return v !== null && typeof v === 'object';
		})
		.sort();
}

/**
 * Normalize args for methods where shell quoting commonly mangles values.
 * For expectVariableToBe, if the value arg (index 1) is a bare string that
 * doesn't already contain quotes, convert it to a RegExp that accepts the
 * value with or without surrounding single/double quotes. This prevents
 * failures when shell/jq processing strips quote characters.
 */
function normalizeArgs(method: string, args: unknown[]): unknown[] {
	if (method === 'expectVariableToBe' && args.length >= 2 && typeof args[1] === 'string') {
		const val = args[1] as string;
		// Already has quotes or is a non-string value (number, list, DataFrame, etc.) -- leave it
		if (/^['"]/.test(val) || /['"]$/.test(val)) {
			return args;
		}
		// Bare string -- could be a number/boolean/structured value, or a string that lost quotes.
		// Only wrap if it looks like a simple word (no brackets, no dots-with-numbers pattern).
		if (/^\w[\w\s]*$/.test(val) && !/^\d/.test(val) && !/^(TRUE|FALSE|True|False|None|NULL|NA|NaN|Inf)$/.test(val)) {
			const escaped = val.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			return [...args.slice(0, 1), new RegExp(`^['"]?${escaped}['"]?$`), ...args.slice(2)];
		}
	}
	return args;
}

/**
 * Resolve POM references in args. Any arg that is an object with a `$pom` key
 * (e.g., `{"$pom": "settings"}`) is replaced with the actual POM instance from
 * the workbench. This allows POM methods that take other POMs as parameters to
 * be called through the runner.
 */
function resolvePomRefs(workbench: Record<string, unknown>, args: unknown[]): unknown[] {
	return args.map(arg => {
		if (arg !== null && typeof arg === 'object' && !Array.isArray(arg) && Object.prototype.hasOwnProperty.call(arg, '$pom')) {
			const pomPath = (arg as Record<string, unknown>)['$pom'];
			if (typeof pomPath === 'string') {
				const { target, error } = resolvePom(workbench, pomPath);
				if (error) {
					throw new Error(`Cannot resolve $pom reference "${pomPath}": ${error}`);
				}
				return target;
			}
		}
		return arg;
	});
}

/** Resolve a possibly-dotted POM path like "sessions" or "dataExplorer". */
function resolvePom(workbench: any, pomPath: string): { target: any; error?: string } {
	const segments = pomPath.split('.');
	let target: any = workbench;
	for (const segment of segments) {
		if (target === null || target === undefined || typeof target !== 'object') {
			return { target: null, error: `Cannot resolve "${pomPath}": "${segment}" is not an object` };
		}
		target = target[segment];
	}
	if (target === null || target === undefined) {
		return {
			target: null,
			error: `Unknown POM: "${pomPath}". Available: ${listPoms(workbench).join(', ')}`,
		};
	}
	return { target };
}

/** Format args for a step label: short, readable, truncated. */
function formatArgs(args: unknown[]): string {
	if (args.length === 0) { return ''; }
	const parts = args.map(a => {
		if (typeof a === 'string') { return a.length > 40 ? `"${a.slice(0, 37)}..."` : `"${a}"`; }
		if (a === null || a === undefined) { return String(a); }
		const s = JSON.stringify(a);
		return s.length > 40 ? s.slice(0, 37) + '...' : s;
	});
	return parts.join(', ');
}

// ---------------------------------------------------------------------------
//  /action executor (Raw + Custom actions)
// ---------------------------------------------------------------------------

function actionStepLabel(request: ActionRequest): string {
	stepCounter++;
	const tier = rawActions.has(request.action) ? 'Raw' : 'Custom';
	if (request.title) {
		return `Step ${stepCounter} [${tier}]: ${request.title}`;
	}
	const params = request.params ?? {};
	const summary = Object.entries(params)
		.filter(([, v]) => v !== undefined && v !== null)
		.map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
		.join(', ');
	return summary
		? `Step ${stepCounter} [${tier}]: ${request.action}(${summary})`
		: `Step ${stepCounter} [${tier}]: ${request.action}`;
}

/**
 * Execute a catalog action (Raw Playwright or Custom logic).
 * Wrapped in test.step() so each action appears as a labeled step in the Playwright report.
 */
export async function executeAction(app: Application, request: ActionRequest): Promise<ActionResult> {
	const label = actionStepLabel(request);

	return await test.step(label, async () => {
		const start = Date.now();

		const handler = actionCatalog[request.action];
		if (!handler) {
			const state = await observeState(app);
			return {
				success: false,
				error: `Unknown action: ${request.action}. Available: ${Object.keys(actionCatalog).join(', ')}`,
				state,
				duration: Date.now() - start,
			};
		}

		try {
			const result = await handler(app, request.params ?? {});
			const state = await observeState(app);
			return { success: true, result, state, duration: Date.now() - start };
		} catch (err: any) {
			const state = await observeState(app);
			return { success: false, error: err.message ?? String(err), state, duration: Date.now() - start };
		}
	});
}

// ---------------------------------------------------------------------------
//  /pom executor (reflection-based POM routing)
// ---------------------------------------------------------------------------

function pomStepLabel(request: PomRequest): string {
	stepCounter++;
	const isDiscovery = request.method === '?' || request.pom === '?';
	const tier = isDiscovery ? 'Discovery' : 'POM';
	const args = formatArgs(request.args ?? []);
	const scope = request.scope !== undefined ? ` [scope:${request.scope}]` : '';
	if (request.title) {
		return `Step ${stepCounter} [${tier}]: ${request.title}${scope}`;
	}
	return `Step ${stepCounter} [${tier}]: ${request.pom}.${request.method}(${args})${scope}`;
}

/**
 * Execute a POM method call via reflection.
 * Resolves app.workbench[pom], optionally scopes to an editor group, calls method(...args).
 */
export async function executePom(app: Application, request: PomRequest): Promise<ActionResult> {
	const label = pomStepLabel(request);

	return await test.step(label, async () => {
		const start = Date.now();
		const workbench = app.workbench as unknown as Record<string, unknown>;

		// 1. Discovery: list POMs when pom is "?"
		if (request.pom === '?') {
			const poms = listPoms(workbench);
			return {
				success: true,
				result: JSON.stringify({ poms }),
				state: {},
				duration: Date.now() - start,
			};
		}

		// 2. Resolve POM
		const { target: rawTarget, error: resolveError } = resolvePom(workbench, request.pom);
		if (resolveError) {
			const state = await observeState(app);
			return { success: false, error: resolveError, state, duration: Date.now() - start };
		}

		// 3. Discovery: return available methods when method is "?"
		if (request.method === '?') {
			const methods = listMethodsWithSignatures(rawTarget);
			return {
				success: true,
				result: JSON.stringify({ pom: request.pom, methods }),
				state: {},
				duration: Date.now() - start,
			};
		}

		// 4. Apply scope if requested
		let target = rawTarget;
		if (request.scope !== undefined) {
			if (typeof target.scopedTo !== 'function') {
				const state = await observeState(app);
				return {
					success: false,
					error: `POM "${request.pom}" does not support scoping. Remove the "scope" param or use a POM that has scopedTo().`,
					state,
					duration: Date.now() - start,
				};
			}
			const group = (app.workbench.editors as any).editorGroup(request.scope);
			target = target.scopedTo(group);
		}

		// 5. Validate method exists
		if (typeof target[request.method] !== 'function') {
			const available = listMethodsWithSignatures(target);
			const state = await observeState(app);
			return {
				success: false,
				error: `Unknown method: "${request.method}" on POM "${request.pom}". Available:\n${available.join('\n')}`,
				state,
				duration: Date.now() - start,
			};
		}

		// 6. Call the method
		try {
			const args = normalizeArgs(request.method, resolvePomRefs(workbench, request.args ?? []));
			const raw = await target[request.method](...args);
			const result = stringify(raw);
			const state = await observeState(app);
			return { success: true, result, state, duration: Date.now() - start };
		} catch (err: any) {
			const state = await observeState(app);
			return { success: false, error: err.message ?? String(err), state, duration: Date.now() - start };
		}
	});
}

// ---------------------------------------------------------------------------
//  /batch executor (fail-fast sequential batch)
// ---------------------------------------------------------------------------

/**
 * Execute a sequence of steps (POM or action) in order.
 * Stops at the first failure. Only observes state once at the end.
 * Wrapped in a single test.step() so the batch appears as one group in the report.
 */
export async function executeBatch(app: Application, request: BatchRequest): Promise<BatchResult> {
	const firstStep = stepCounter + 1;
	const lastStep = stepCounter + request.steps.length;
	const stepRange = firstStep === lastStep ? `Step ${firstStep}` : `Steps ${firstStep}-${lastStep}`;
	const batchLabel = request.title
		? `${stepRange}: ${request.title}`
		: `${stepRange}`;

	// Store result outside test.step so we can return it even if we throw
	let batchResult: BatchResult | undefined;

	try {
		await test.step(batchLabel, async () => {
			const completed: ActionResult[] = [];

			for (let i = 0; i < request.steps.length; i++) {
				const step = request.steps[i];
				const start = Date.now();
				let result: ActionResult;

				try {
					if (step.type === 'pom') {
						result = await executePomDirect(app, step);
					} else {
						result = await executeActionDirect(app, step);
					}
				} catch (err: any) {
					const state = await observeState(app);
					batchResult = {
						completed,
						failed: {
							success: false,
							error: err.message ?? String(err),
							state,
							duration: Date.now() - start,
							index: i,
						},
						skipped: request.steps.length - i - 1,
						state,
					};
					throw err; // Re-throw so test.step shows failure
				}

				if (!result.success) {
					const state = await observeState(app);
					batchResult = {
						completed,
						failed: { ...result, state, index: i },
						skipped: request.steps.length - i - 1,
						state,
					};
					throw new Error(result.error ?? 'Step failed');
				}

				// Strip state from intermediate results to keep response lean
				completed.push({ ...result, state: {} });
			}

			// All steps succeeded -- observe state once at the end
			const state = await observeState(app);
			batchResult = {
				completed,
				skipped: 0,
				state,
			};
		});
	} catch {
		// Error already stored in batchResult -- swallow so HTTP handler gets the result
	}

	return batchResult!;
}

/**
 * Execute a POM step directly (no observeState, no test.step wrapper).
 * Used by batch executor to avoid per-step overhead.
 */
async function executePomDirect(app: Application, step: BatchStep): Promise<ActionResult> {
	const start = Date.now();
	const workbench = app.workbench as unknown as Record<string, unknown>;
	const pomPath = step.pom!;
	const method = step.method!;

	stepCounter++;
	const tier = 'POM';
	const scope = step.scope !== undefined ? ` [scope:${step.scope}]` : '';
	const label = step.title
		? `Step ${stepCounter} [${tier}]: ${step.title}${scope}`
		: `Step ${stepCounter} [${tier}]: ${pomPath}.${method}(${formatArgs(step.args ?? [])})${scope}`;

	return await test.step(label, async () => {
		const { target: rawTarget, error: resolveError } = resolvePom(workbench, pomPath);
		if (resolveError) {
			return { success: false, error: resolveError, state: {}, duration: Date.now() - start };
		}

		let target = rawTarget;
		if (step.scope !== undefined) {
			if (typeof target.scopedTo !== 'function') {
				return {
					success: false,
					error: `POM "${pomPath}" does not support scoping.`,
					state: {},
					duration: Date.now() - start,
				};
			}
			const group = (app.workbench.editors as any).editorGroup(step.scope);
			target = target.scopedTo(group);
		}

		if (typeof target[method] !== 'function') {
			const available = listMethodsWithSignatures(target);
			return {
				success: false,
				error: `Unknown method: "${method}" on POM "${pomPath}". Available:\n${available.join('\n')}`,
				state: {},
				duration: Date.now() - start,
			};
		}

		const args = normalizeArgs(method, resolvePomRefs(workbench, step.args ?? []));
		const raw = await target[method](...args);
		return { success: true, result: stringify(raw), state: {}, duration: Date.now() - start };
	});
}

/**
 * Execute an action step directly (no observeState, no test.step wrapper around observer).
 * Used by batch executor to avoid per-step overhead.
 */
async function executeActionDirect(app: Application, step: BatchStep): Promise<ActionResult> {
	const start = Date.now();
	const actionName = step.action!;
	stepCounter++;
	const tier = rawActions.has(actionName) ? 'Raw' : 'Custom';
	const label = step.title
		? `Step ${stepCounter} [${tier}]: ${step.title}`
		: `Step ${stepCounter} [${tier}]: ${actionName}`;

	return await test.step(label, async () => {
		const handler = actionCatalog[actionName];
		if (!handler) {
			return {
				success: false,
				error: `Unknown action: ${actionName}. Available: ${Object.keys(actionCatalog).join(', ')}`,
				state: {},
				duration: Date.now() - start,
			};
		}

		const result = await handler(app, step.params ?? {});
		return { success: true, result, state: {}, duration: Date.now() - start };
	});
}

// ---------------------------------------------------------------------------
//  /run-plan executor (full test plan with timeouts and reset)
// ---------------------------------------------------------------------------

/**
 * Execute a complete test plan in one call.
 *
 * Differences from /batch:
 *   - Optional state reset before execution (resetBefore)
 *   - Per-step timeout with a configurable default (stepTimeout)
 *   - Structured RunPlanResult with passed/failed counts
 *   - Fail-fast: stops at first failure, observes state, returns report
 */
export async function executeRunPlan(app: Application, request: RunPlanRequest): Promise<RunPlanResult> {
	const startTime = Date.now();

	// 1. Optional state reset (indicates a retry attempt)
	let resetActions: string[] | undefined;
	if (request.resetBefore) {
		resetActions = await test.step('--- Retry ---', async () => {
			return await resetState(app);
		});
		// Reset step counter so retry steps start from 1
		stepCounter = 0;
	}

	// 2. Execute steps sequentially with per-step timeouts
	const stepResults: RunPlanStepResult[] = [];
	const defaultTimeout = request.stepTimeout ?? 10000;

	for (let i = 0; i < request.steps.length; i++) {
		const step = request.steps[i];
		const timeout = step.timeout ?? defaultTimeout;
		const stepStart = Date.now();
		const title = step.title || `Step ${i + 1}`;

		let actionResult: ActionResult;
		try {
			actionResult = await Promise.race([
				step.type === 'pom'
					? executePomDirect(app, step)
					: executeActionDirect(app, step),
				createStepTimeout(timeout),
			]);
		} catch (err: any) {
			// Thrown error: timeout or POM method failure
			stepResults.push({
				title,
				success: false,
				error: err.message ?? String(err),
				duration: Date.now() - stepStart,
			});
			const state = await observeState(app);
			return {
				passed: stepResults.filter(s => s.success).length,
				failed: 1,
				steps: stepResults,
				skipped: request.steps.length - i - 1,
				totalDuration: Date.now() - startTime,
				state,
				resetActions,
			};
		}

		// Returned error (e.g., unknown POM or method)
		if (!actionResult.success) {
			stepResults.push({
				title,
				success: false,
				error: actionResult.error,
				duration: Date.now() - stepStart,
			});
			const state = await observeState(app);
			return {
				passed: stepResults.filter(s => s.success).length,
				failed: 1,
				steps: stepResults,
				skipped: request.steps.length - i - 1,
				totalDuration: Date.now() - startTime,
				state,
				resetActions,
			};
		}

		stepResults.push({
			title,
			success: true,
			duration: Date.now() - stepStart,
		});
	}

	// 3. All steps passed -- observe final state
	const state = await observeState(app);
	return {
		passed: stepResults.length,
		failed: 0,
		steps: stepResults,
		totalDuration: Date.now() - startTime,
		state,
		resetActions,
	};
}
