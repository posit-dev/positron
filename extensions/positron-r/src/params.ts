/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as vscode from 'vscode';
import * as positron from 'positron';
import * as yaml from 'js-yaml';

import { LOGGER } from './extension.js';
import { RSession } from './session.js';

/**
 * Quarto/RMarkdown params binder for R notebook sessions.
 *
 * `rmarkdown::render` and `quarto::render` populate a `params` list in the
 * global environment from a document's YAML front matter. Positron opens
 * these documents as notebooks and bypasses the render entry point, so this
 * module mirrors the binding ourselves: parse the front matter, render the
 * `params:` block as R code, and assign on the kernel's first Ready state
 * and on every subsequent save of the bound document. Supports primitives,
 * dates, arrays, the structured `{value, label, input, choices}` form, and
 * `!r` / `!expr` expression tags.
 */

/**
 * Marker produced when js-yaml encounters an `!r` or `!expr` tag.
 * The wrapped string is interpolated verbatim into the generated R code.
 */
interface RExprMarker {
	readonly __rExpr: true;
	readonly code: string;
}

function isExprMarker(val: unknown): val is RExprMarker {
	return !!val && typeof val === 'object' && (val as RExprMarker).__rExpr === true;
}

const exprConstruct = (data: unknown): RExprMarker => ({
	__rExpr: true,
	code: typeof data === 'string' ? data : '',
});

const RTagType = new yaml.Type('!r', {
	kind: 'scalar',
	resolve: () => true,
	construct: exprConstruct,
});

const ExprTagType = new yaml.Type('!expr', {
	kind: 'scalar',
	resolve: () => true,
	construct: exprConstruct,
});

const PARAMS_SCHEMA = yaml.DEFAULT_SCHEMA.extend([RTagType, ExprTagType]);

/**
 * Extract the YAML front matter from a document body, or undefined if there
 * isn't one. The front matter must start at the very beginning of the file
 * (after an optional BOM) and is delimited by `---` lines.
 */
export function extractFrontMatter(text: string): string | undefined {
	// Strip a UTF-8 BOM if present.
	const body = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
	if (!body.startsWith('---')) {
		return undefined;
	}
	// Match `---\n...\n---` or `---\n...\n...` (YAML allows `...` as a closing
	// document marker).
	const m = body.match(/^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)(?:\r?\n|$)/);
	return m?.[1];
}

const R_RESERVED = new Set([
	'if', 'else', 'repeat', 'while', 'function', 'for', 'in', 'next', 'break',
	'TRUE', 'FALSE', 'NULL', 'Inf', 'NaN', 'NA', 'NA_integer_', 'NA_real_',
	'NA_complex_', 'NA_character_',
]);

function escapeRName(name: string): string {
	if (/^[A-Za-z.][A-Za-z0-9._]*$/.test(name) && !R_RESERVED.has(name)) {
		return name;
	}
	return '`' + name.replace(/\\/g, '\\\\').replace(/`/g, '\\`') + '`';
}

function formatNumber(n: number): string {
	if (Number.isNaN(n)) { return 'NaN'; }
	if (!Number.isFinite(n)) { return n > 0 ? 'Inf' : '-Inf'; }
	return String(n);
}

function formatDate(d: Date): string {
	const iso = d.toISOString();
	// js-yaml parses both date-only (`2024-01-01`) and full-timestamp scalars
	// into Date objects, with no way to recover the original form. Treat UTC
	// midnight as a date scalar, anything else as a timestamp -- the common
	// YAML use case is date-only and we want as.Date() there.
	if (iso.endsWith('T00:00:00.000Z')) {
		return `as.Date("${iso.slice(0, 10)}")`;
	}
	return `as.POSIXct("${iso.replace('T', ' ').replace(/\.\d{3}Z$/, '')}", tz = "UTC")`;
}

/**
 * Render a JS value (as parsed by js-yaml with the params schema) as an R
 * expression. Strings, numbers, booleans, null, dates, expression markers,
 * arrays, and plain objects are supported. Arrays of homogeneous primitives
 * become `c(...)`; anything else becomes `list(...)`.
 */
export function toRLiteral(val: unknown): string {
	if (val === null || val === undefined) {
		return 'NULL';
	}
	if (isExprMarker(val)) {
		return `(${val.code})`;
	}
	if (typeof val === 'boolean') {
		return val ? 'TRUE' : 'FALSE';
	}
	if (typeof val === 'number') {
		return formatNumber(val);
	}
	if (typeof val === 'string') {
		return JSON.stringify(val);
	}
	if (val instanceof Date) {
		return formatDate(val);
	}
	if (Array.isArray(val)) {
		if (val.length === 0) {
			return 'list()';
		}
		const first = val[0];
		const firstType = first === null ? null : typeof first;
		const homogeneousScalar =
			firstType !== null &&
			(firstType === 'boolean' || firstType === 'number' || firstType === 'string') &&
			val.every(v => typeof v === firstType);
		const rendered = val.map(toRLiteral).join(', ');
		return homogeneousScalar ? `c(${rendered})` : `list(${rendered})`;
	}
	if (typeof val === 'object') {
		const entries = Object.entries(val as Record<string, unknown>);
		if (entries.length === 0) {
			return 'list()';
		}
		return `list(${entries.map(([k, v]) => `${escapeRName(k)} = ${toRLiteral(v)}`).join(', ')})`;
	}
	return 'NULL';
}

/**
 * If a top-level params entry is an object with a `value` field (the
 * structured form used to attach `label`/`input`/`choices`), unwrap to the
 * value. Otherwise return the raw value unchanged.
 */
function unwrapTopLevelParam(raw: unknown): unknown {
	if (
		raw &&
		typeof raw === 'object' &&
		!Array.isArray(raw) &&
		!(raw instanceof Date) &&
		!isExprMarker(raw)
	) {
		const obj = raw as Record<string, unknown>;
		if (Object.prototype.hasOwnProperty.call(obj, 'value')) {
			return obj.value;
		}
	}
	return raw;
}

/**
 * Build the R code that assigns `params` in the global environment based on
 * the `params:` block in a YAML front matter. Returns undefined if the front
 * matter is absent or has no `params:` key. Throws when the YAML is malformed
 * and a `params:` section appears to be present -- callers can ignore the
 * throw if no params binding is expected.
 */
export function buildParamsRCode(frontMatterYaml: string | undefined): string | undefined {
	if (!frontMatterYaml) {
		return undefined;
	}
	let parsed: unknown;
	try {
		parsed = yaml.load(frontMatterYaml, { schema: PARAMS_SCHEMA });
	} catch (err) {
		// Only surface parse errors when the document looks like it intends to
		// define params. Otherwise we'd complain about every malformed header
		// even when there's no params binding at stake.
		if (/^\s*params\s*:/m.test(frontMatterYaml)) {
			throw err;
		}
		return undefined;
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		return undefined;
	}
	const params = (parsed as Record<string, unknown>).params;
	if (params === undefined || params === null) {
		return undefined;
	}
	if (typeof params !== 'object' || Array.isArray(params)) {
		// `params:` must be a map. Anything else is malformed; skip silently.
		return undefined;
	}
	const entries = Object.entries(params as Record<string, unknown>);
	const rendered = entries
		.map(([k, v]) => `${escapeRName(k)} = ${toRLiteral(unwrapTopLevelParam(v))}`)
		.join(', ');
	return `assign("params", list(${rendered}), envir = globalenv())`;
}

/**
 * Format an error for logging. Errors thrown by `evaluateCode` are typically
 * `RuntimeMethodError`-shaped objects (`{ message, code, name, data }`),
 * which stringify to `[object Object]` by default; this prefers `.message`
 * and falls back to JSON.
 */
function formatError(err: unknown): string {
	if (err instanceof Error) {
		return err.message;
	}
	if (err && typeof err === 'object') {
		const e = err as { message?: unknown; code?: unknown };
		if (typeof e.message === 'string') {
			return typeof e.code === 'number'
				? `${e.message} (code ${e.code})`
				: e.message;
		}
		try {
			return JSON.stringify(err);
		} catch {
			// fall through
		}
	}
	return String(err);
}

/**
 * Display name for the document type backing a session, derived from the
 * notebook URI extension. Returns undefined if the session isn't backed by
 * a Quarto or R Markdown document.
 */
function docFlavor(session: RSession): 'Quarto' | 'R Markdown' | undefined {
	const path = session.metadata.notebookUri?.path.toLowerCase();
	if (path?.endsWith('.qmd')) {
		return 'Quarto';
	}
	if (path?.endsWith('.rmd')) {
		return 'R Markdown';
	}
	return undefined;
}

/**
 * Determines whether a session should have `params` bound from the YAML
 * front matter of its associated document.
 */
function isQuartoOrRmdNotebookSession(session: RSession): boolean {
	return session.metadata.sessionMode === positron.LanguageRuntimeSessionMode.Notebook
		&& docFlavor(session) !== undefined;
}

/**
 * Per-session binder that mirrors a Quarto/RMarkdown document's `params:`
 * block into a `params` list in the R global environment. Refreshes on the
 * first `Ready` state and on subsequent saves of the bound document.
 */
export class ParamsBinder implements vscode.Disposable {
	private readonly _disposables: vscode.Disposable[] = [];

	/**
	 * The most recently observed front matter text; used to skip re-evaluation
	 * when a save doesn't touch the YAML header. Cleared on `Ready` so that a
	 * kernel restart forces a fresh sync against the same document.
	 */
	private _lastFrontMatter: string | undefined;

	private _disposed = false;

	constructor(private readonly _session: RSession) { }

	start(): void {
		if (!isQuartoOrRmdNotebookSession(this._session)) {
			return;
		}

		this._disposables.push(
			this._session.onDidChangeRuntimeState(state => {
				if (state === positron.RuntimeState.Ready) {
					this._lastFrontMatter = undefined;
					// Initial bind: the user didn't trigger this, so failures
					// stay in the log rather than popping a toast.
					void this.sync(undefined, false);
				}
			})
		);

		this._disposables.push(
			vscode.workspace.onDidSaveTextDocument(doc => {
				if (doc.uri.toString() === this._session.metadata.notebookUri?.toString()) {
					// User-initiated save: surface failures as a toast.
					void this.sync(doc.getText(), true);
				}
			})
		);
	}

	private async sync(text: string | undefined, notifyOnError: boolean): Promise<void> {
		if (this._disposed) {
			return;
		}

		const uri = this._session.metadata.notebookUri;
		if (!uri) {
			return;
		}

		try {
			if (text === undefined) {
				const doc = await vscode.workspace.openTextDocument(uri);
				text = doc.getText();
			}
		} catch (err) {
			LOGGER.debug(`params sync: failed to read ${uri.toString()}: ${formatError(err)}`);
			return;
		}

		const fm = extractFrontMatter(text);
		// Front matter unchanged since our last attempt -- skip silently. This
		// also dedups error toasts: a failed attempt records its front matter
		// here so the same broken header doesn't surface a second notification.
		if (fm === this._lastFrontMatter) {
			return;
		}
		this._lastFrontMatter = fm;

		let code: string | undefined;
		try {
			code = buildParamsRCode(fm);
		} catch (err) {
			// YAML parse errors are noisy and hard to interpret out of context;
			// log them but don't surface a toast. The user already sees the
			// problem in their editor.
			LOGGER.warn(
				`Failed to parse YAML front matter for ${uri.toString()}: ${formatError(err)}\nFront matter:\n${fm}`,
			);
			return;
		}

		if (!code) {
			return;
		}

		LOGGER.info(`Binding params for ${uri.toString()}: ${code}`);

		try {
			await positron.runtime.evaluateCode(
				'r',
				code,
				undefined,
				this._session.metadata.sessionId,
			);
		} catch (err) {
			LOGGER.warn(
				`Failed to bind params for ${uri.toString()}: ${formatError(err)}\nGenerated code:\n${code}`,
			);
			if (notifyOnError) {
				void this.showEvalErrorNotification();
			}
		}
	}

	private async showEvalErrorNotification(): Promise<void> {
		const flavor = docFlavor(this._session) ?? 'Quarto';
		const filename = path.basename(this._session.metadata.notebookUri?.path ?? '');
		const message = flavor === 'Quarto'
			? vscode.l10n.t('{0}: An error occurred evaluating the Quarto params in the document header.', filename)
			: vscode.l10n.t('{0}: An error occurred evaluating the R Markdown params in the document header.', filename);
		const showLog = vscode.l10n.t('Show Log');
		const choice = await vscode.window.showErrorMessage(message, showLog);
		if (choice === showLog) {
			LOGGER.show();
		}
	}

	dispose(): void {
		this._disposed = true;
		while (this._disposables.length > 0) {
			this._disposables.pop()?.dispose();
		}
	}
}
