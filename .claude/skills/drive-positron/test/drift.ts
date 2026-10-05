/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// UI drift: does Positron's source still produce every entry in scripts/selectors.ts?
// No app, a few seconds. From the repo root:
//
//   node .claude/skills/drive-positron/test/drift.ts [--all] [--root DIR]
//
// It reads src/ and extensions/ (TS, TSX, CSS, package.json, package.nls.json;
// no tests, out/, node_modules) and checks each entry:
//   css       every class in the selector is a word there (a codicon-X class by
//             its icon id X); [role=], [aria-label=], [style*=], [class*=] and
//             tags are skipped. ...TestId: a data-testid that starts with it.
//             ...Class: a class that starts with it. ...Attr, ...Var: the word.
//   names     a string literal (localize() text, package.json titles), or a
//             literal with {0} placeholders whose filled-in parts are literals
//             too ("Focus on {0} View" + "Console"). Palette titles: category
//             and title separately. ...Pattern: the PATTERNS table below.
// A generic word (.active, "Continue") is looked for only in its group's AREA.
// Prints MISSING and SKIPPED entries (--all: FOUND too) with the helpers that
// use them, and exits 1 when any is MISSING. --root checks another tree.

import { readdirSync, readFileSync } from 'fs';
import { dirname, join, relative, resolve } from 'path';
import { css, names } from '../scripts/selectors.ts';

const skill = resolve(dirname(new URL(import.meta.url).pathname), '..');
const scripts = join(skill, 'scripts');

// ---- Tables

/** Where a group's generic entries must still appear (path prefixes under the root). */
const AREA: Record<string, string[]> = {
	'css.workbench': ['src/vs/base/browser/ui/sash'],
	'css.list': ['src/vs/base/browser/ui/list'],
	'css.menu': ['src/vs/base/browser/ui/menu'],
	'css.label': ['src/vs/base/browser/ui/iconLabel'],
	'css.dialog': ['src/vs/base/browser/ui/dialog', 'src/vs/workbench/browser/positronComponents', 'src/vs/workbench/browser/positronModalDialogs'],
	'css.editorGroup': ['src/vs/workbench/browser/parts/editor'],
	'css.monaco': ['src/vs/editor'],
	'css.console': ['src/vs/workbench/contrib/positronConsole'],
	'css.plots': ['src/vs/workbench/contrib/positronPlots'],
	'css.dataGrid': ['src/vs/workbench/browser/positronDataGrid', 'src/vs/workbench/browser/positronDataExplorer'],
	'names.views': ['src/vs/workbench/contrib/debug', 'src/vs/workbench/contrib/positronPlots', 'src/vs/workbench/contrib/positronPreview'],
	'names.viewer': ['src/vs/workbench/contrib/positronPreview'],
	'names.plots': ['src/vs/workbench/contrib/positronPlots', 'src/vs/platform/positronActionBar'],
	'names.panel': ['src/vs/workbench/contrib/positronConsole'],
	'names.debug': ['src/vs/workbench/contrib/debug'],
};

/** Classes that match somewhere in any tree: checked only in their group's AREA. */
const GENERIC = new Set(['title', 'selected', 'dirty', 'active', 'disabled', 'focused', 'horizontal', 'vertical', 'label-name', 'keybinding']);

/**
 * A ...Pattern name is a regex the helpers build at runtime. Each maps to the
 * source literals it is meant to match: every one must exist (in the group's
 * AREA when it has one) and, with its {0} placeholders filled in, match.
 */
const PATTERNS: Record<string, string[]> = {
	'names.editor.cursorStatusPattern': ['Ln {0}, Col {1}', 'Ln {0}, Col {1} ({2} selected)'],
	'names.plots.zoomPattern': ['Fit'],
	'names.nb.runCellPattern': ['Run Cell', 'Execute Cell'],
	// A Run App button is named by its extension's command title; both patterns pick it out.
	'names.runApp.runPattern': ['Run Flask App in Terminal', 'Run Streamlit App in Terminal'],
	'names.runApp.appPattern': ['Run Flask App in Terminal', 'Run Streamlit App in Terminal'],
};

/** Entries this check cannot find in source, and why. */
const SKIP: Record<string, string> = {
	'css.view.stacked': 'an inline style the product sets at runtime, not a class',
};

// ---- Source

interface Index { lits: Set<string>; words: Set<string>; templates: { re: RegExp; text: string }[] }
interface File { path: string; text: string }
const SKIP_DIRS = new Set(['node_modules', 'out', '.build', 'dist', 'test', 'tests', 'i18n', 'syntaxes']);

function readTree(root: string): File[] {
	const files: File[] = [];
	const walk = (dir: string) => {
		for (const e of readdirSync(dir, { withFileTypes: true })) {
			const p = join(dir, e.name);
			if (e.isDirectory()) {
				if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) { walk(p); }
			} else if (/\.(tsx?|css)$/.test(e.name) && !/\.(test|vitest|d)\.tsx?$/.test(e.name) || /^package(\.nls)?\.json$/.test(e.name)) {
				files.push({ path: relative(root, p), text: readFileSync(p, 'utf8') });
			}
		}
	};
	for (const top of ['src', 'extensions']) { walk(join(root, top)); }
	return files;
}

function index(files: File[]): Index {
	const lits = new Set<string>();
	const words = new Set<string>();
	for (const { text } of files) {
		for (const m of text.matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'/g)) { lits.add(m[1] ?? m[2]); }
		for (const m of text.matchAll(/[\w-]+/g)) { words.add(m[0]); }
	}
	// "Focus on {0} View": a template with at least four letters of its own.
	const esc = (s: string) => s.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
	const templates = [...lits].filter(l => /\{\d\}/.test(l) && /[a-zA-Z]{4}/.test(l.replace(/\{\d\}/g, '')))
		.map(text => ({ text, re: new RegExp('^' + text.split(/\{\d\}/).map(esc).join('(.+)') + '$') }));
	return { lits, words, templates };
}

/** A name as a literal, or as a template whose filled-in parts are literals or numbers. */
function hasName(ix: Index, name: string): string | undefined {
	if (ix.lits.has(name)) { return name; }
	for (const t of ix.templates) {
		const m = t.re.exec(name);
		if (m && m.slice(1).every(part => ix.lits.has(part) || /^\d+$/.test(part))) { return t.text; }
	}
	return undefined;
}

// ---- Checks

type Status = 'FOUND' | 'MISSING' | 'SKIPPED';
export interface Result { key: string; value: string; status: Status; note: string }

export function drift(root: string): Result[] {
	const files = readTree(root);
	const all = index(files);
	const areas = new Map<string, Index>();
	const area = (group: string) => {
		const dirs = AREA[group];
		if (!dirs) { return undefined; }
		if (!areas.has(group)) { areas.set(group, index(files.filter(f => dirs.some(d => f.path.startsWith(d + '/'))))); }
		return areas.get(group)!;
	};
	const results: Result[] = [];
	const add = (key: string, value: string, status: Status, note: string) => results.push({ key, value, status, note });

	for (const [g, entries] of Object.entries(css)) {
		for (const [k, value] of Object.entries(entries) as [string, string][]) {
			const key = `css.${g}.${k}`;
			if (SKIP[key]) { add(key, value, 'SKIPPED', SKIP[key]); continue; }
			if (k.endsWith('TestId')) {
				const re = new RegExp(`data-testid=\\{?\\s*[\`'"]${value}`);
				const hit = files.find(f => /\.tsx?$/.test(f.path) && re.test(f.text));
				add(key, value, hit ? 'FOUND' : 'MISSING', hit ? hit.path : `no data-testid starting "${value}"`);
				continue;
			}
			if (k.endsWith('Class')) {
				const hit = [...all.words].find(w => w.startsWith(value));
				add(key, value, hit ? 'FOUND' : 'MISSING', hit ?? `no class starting "${value}"`);
				continue;
			}
			if (k.endsWith('Attr') || k.endsWith('Var')) {
				add(key, value, all.words.has(value) ? 'FOUND' : 'MISSING', all.words.has(value) ? '' : `no "${value}"`);
				continue;
			}
			// A selector: its classes, without attribute selectors, quoted text and tags.
			const classes = [...new Set([...value.replace(/\[[^\]]*\]/g, '').matchAll(/\.(-?[a-zA-Z_][\w-]*)/g)].map(m => m[1]))];
			if (!classes.length) { add(key, value, 'SKIPPED', 'no class to look for (roles, attributes or tags only)'); continue; }
			const missing: string[] = [];
			const skipped: string[] = [];
			for (const c of classes) {
				const icon = c.startsWith('codicon-') && c !== 'codicon-' ? c.slice(8) : undefined;
				if (GENERIC.has(c)) {
					const ix = area(`css.${g}`);
					if (!ix) { skipped.push(`.${c} is generic and css.${g} has no AREA`); } else if (!ix.words.has(c)) { missing.push(`.${c} (in ${AREA[`css.${g}`].join(', ')})`); }
				} else if (!all.words.has(icon ?? c)) {
					missing.push(icon ? `.${c} (icon id "${icon}")` : `.${c}`);
				}
			}
			const status = missing.length ? 'MISSING' : skipped.length === classes.length ? 'SKIPPED' : 'FOUND';
			add(key, value, status, missing.length ? `no ${missing.join(', ')}` : skipped.length ? `SKIPPED-generic: ${skipped.join('; ')}` : '');
		}
	}

	for (const [g, entries] of Object.entries(names)) {
		for (const [k, value] of Object.entries(entries) as [string, string][]) {
			const key = `names.${g}.${k}`;
			if (SKIP[key]) { add(key, value, 'SKIPPED', SKIP[key]); continue; }
			const ix = area(`names.${g}`) ?? all;
			if (k.endsWith('Pattern')) {
				const want = PATTERNS[key];
				if (!want) { add(key, value, 'MISSING', `a pattern with no PATTERNS entry in drift.ts: map it to the source strings it matches`); continue; }
				const re = new RegExp(value);
				const bad = want.filter(l => !ix.lits.has(l)).map(l => `no "${l}"`)
					.concat(want.filter(l => !re.test(l.replace(/\{\d\}/g, '12'))).map(l => `"${l}" does not match /${value}/`));
				add(key, value, bad.length ? 'MISSING' : 'FOUND', bad.join('; ') || want.join(' | '));
				continue;
			}
			const generic = !/\s/.test(value);
			if (generic && ix === all) { add(key, value, 'SKIPPED', `SKIPPED-generic: a single word, and names.${g} has no AREA`); continue; }
			// A palette title is "Category: Title", each localized on its own.
			const parts = g === 'palette' ? (ix.lits.has(value) ? [value] : [value.slice(0, value.indexOf(': ')), value.slice(value.indexOf(': ') + 2)]) : [value];
			const missing = parts.filter(p => !hasName(ix, p));
			add(key, value, missing.length ? 'MISSING' : 'FOUND', missing.length ? `no string ${missing.map(m => `"${m}"`).join(' or ')}${ix === all ? '' : ` in ${AREA[`names.${g}`].join(', ')}`}` : parts.map(p => hasName(ix, p)).join(' + '));
		}
	}
	return results;
}

/** The helper lines that read an entry: kind.group.key, $group_key, or .key in a file that reads the group. */
export function usedBy(key: string): string[] {
	const [kind, g, k] = key.split('.');
	const out: string[] = [];
	for (const f of readdirSync(scripts).filter(f => /\.(ts|sh)$/.test(f) && f !== 'selectors.ts')) {
		const lines = readFileSync(join(scripts, f), 'utf8').split('\n');
		const readsGroup = lines.some(l => new RegExp(`\\b${kind}\\.${g}\\b(?!\\.)`).test(l));
		lines.forEach((l, i) => {
			if (new RegExp(`\\.${g}\\.${k}\\b|\\b${g}_${k}\\b`).test(l) || (readsGroup && new RegExp(`\\.${k}\\b`).test(l))) { out.push(`${f}:${i + 1}`); }
		});
	}
	return out;
}

/** The lines drift.ts prints for one result. */
export function describe(r: Result): string[] {
	const head = `${r.status.padEnd(8)} ${r.key}  ${JSON.stringify(r.value)}`;
	if (r.status === 'FOUND') { return [r.note ? `${head}  (${r.note})` : head]; }
	if (r.status === 'SKIPPED') { return [`${head}\n         why: ${r.note}`]; }
	const used = usedBy(r.key);
	return [head,
		`         ${r.note}`,
		`         used by: ${used.length ? used.join(', ') : 'nothing found by name; grep scripts/ for the key'}`,
		`         hint: if the product renamed it, change ${r.key} in scripts/selectors.ts to what src/ now has, then run test/check.ts and test/smoke.ts`];
}

if (import.meta.main) {
	const argv = process.argv.slice(2);
	const at = argv.indexOf('--root');
	const root = at >= 0 ? resolve(argv[at + 1]) : resolve(skill, '../../..');
	const t = Date.now();
	const results = drift(root);
	for (const r of results) {
		if (r.status !== 'FOUND' || argv.includes('--all')) { console.log(describe(r).join('\n')); }
	}
	const count = (s: Status) => results.filter(r => r.status === s).length;
	console.log(`drift: ${count('FOUND')} found, ${count('MISSING')} missing, ${count('SKIPPED')} skipped of ${results.length} entries in ${root} (${Date.now() - t} ms)`);
	process.exitCode = count('MISSING') ? 1 : 0;
}
