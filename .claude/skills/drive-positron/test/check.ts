/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// drive-positron's static checks: no app, a few seconds. From the repo root:
//
//   node .claude/skills/drive-positron/test/check.ts
//
// types   tsc over scripts/*.ts and test/*.ts with ../tsconfig.json
// pagefn  page functions and browser functions are self-contained (page-fns.ts),
//         and the check still catches a planted violation
// lint    the repo's eslint, errors only; and ASCII only in scripts/, test/ and
//         the docs (write a product's non-ASCII label as an escape, \u00B7)
// help    every .sh parses (bash -n), has a Usage header, and prints exactly that
//         header for --help and -h through usage() in dp-lib.ts; every dp.ts
//         command has a .sh
// registry  no helper names a class or test id outside selectors.ts, and every
//         entry there is read somewhere
// drift   every selectors.ts entry is still produced by src/ and extensions/
//         (drift.ts; run it alone for FOUND and SKIPPED too)
//
// Prints one line per check and exits 1 when any fails.

import { execFile, spawnSync } from 'child_process';
import { readdirSync, readFileSync, existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { promisify } from 'util';
import { header } from '../scripts/dp-lib.ts';
import { css, names } from '../scripts/selectors.ts';
import { describe, drift } from './drift.ts';
import { pageFnProblems } from './page-fns.ts';

const test = dirname(new URL(import.meta.url).pathname);
const skill = resolve(test, '..');
const scripts = join(skill, 'scripts');
const repo = resolve(skill, '../../..');
const bin = (name: string) => join(repo, 'node_modules/.bin', name);
const ts = (dir: string) => readdirSync(dir).filter(f => f.endsWith('.ts')).map(f => join(dir, f));
const sh = readdirSync(scripts).filter(f => f.endsWith('.sh')).sort();

/** Runs a tool and returns its output lines when it fails, nothing when it passes. */
function run(cmd: string, args: string[]): string[] {
	const r = spawnSync(cmd, args, { cwd: repo, encoding: 'utf8' });
	if (r.status === 0) { return []; }
	return `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? String(r.error) : ''}`.split('\n').filter(l => l.trim());
}

const checks: Record<string, () => string[] | Promise<string[]>> = {
	types: () => run(bin('tsc'), ['-p', join(skill, 'tsconfig.json')]),

	pagefn: () => {
		const files = ts(scripts);
		const real = pageFnProblems(files);
		// The self-test: a planted file with three kinds of violation must give exactly these four.
		const planted = [
			`import { inPage, mod, type PageFn } from './dp-lib.ts';`,
			`const LIMIT = 3;`,
			`export const bad: PageFn<{ n: number }> = async (page, a) => { await page.keyboard.press(mod); return { ok: a.n > LIMIT }; };`,
			`export const good: PageFn<{ n: number }> = async (page, a) => ({ ok: await page.evaluate(n => n > 1, a.n) });`,
			`export const leak: PageFn<{ n: number }> = async (page, a) => ({ ok: await page.evaluate(() => a.n > 1) });`,
			`inPage('', async () => ({ ok: LIMIT > 0 }), {});`,
		].join('\n');
		const got = pageFnProblems(files, { name: join(scripts, '__planted__.ts'), text: planted }).problems
			.filter(p => p.includes('__planted__')).map(p => p.replace(/^.*?:(\d+):.*"(\w+)".*$/, '$1:$2')).sort();
		const want = ['3:LIMIT', '3:mod', '5:a', '6:LIMIT'];
		const self = JSON.stringify(got) === JSON.stringify(want) ? [] : [`self-test: the planted violations gave ${JSON.stringify(got)}, not ${JSON.stringify(want)}`];
		if (real.checked < 40) { self.push(`only ${real.checked} page functions found; the PageFn type or inPage signature may have changed`); }
		return [...real.problems, ...self];
	},

	lint: () => {
		const files = [...readdirSync(scripts).map(f => join(scripts, f)), ...ts(test), ...['SKILL.md', 'CONTRIBUTING.md', 'test/README.md'].map(f => join(skill, f))];
		const ascii = files.flatMap(f => readFileSync(f, 'utf8').split('\n').flatMap((l, i) => /[^\x00-\x7F]/.test(l) ? [`${f.slice(skill.length + 1)}:${i + 1}: not ASCII: ${l.trim().slice(0, 80)}`] : []));
		return [...ascii, ...run(bin('eslint'), ['--quiet', ...ts(scripts), ...ts(test)])];
	},

	help: async () => {
		const problems: string[] = [];
		// One mechanism: a thin wrapper execs a dp.ts command, which calls usage();
		// any other script's -h|--help case runs `dp.ts help "$0"`, which calls it too.
		const thin = /^exec node "\$\(dirname "\$\{BASH_SOURCE\[0\]\}"\)\/dp\.ts" [\w-]+ "\$@"$/m;
		const runs = await Promise.all(sh.map(async f => {
			const file = join(scripts, f);
			const text = readFileSync(file, 'utf8');
			const want = header(file);
			const out: string[] = [];
			if (!/Usage/.test(want)) { out.push(`${f}: no Usage in its header comment`); }
			if (!thin.test(text) && !text.includes('-h|--help) exec node "$DIR/dp.ts" help "$0"')) { out.push(`${f}: no -h|--help) case that runs dp.ts help "$0"`); }
			for (const flag of ['--help', '-h']) {
				const r = await promisify(execFile)('bash', [file, flag], { cwd: repo, timeout: 15000 }).catch((e: { stdout?: string; code?: number }) => ({ stdout: e.stdout ?? '', code: e.code }));
				if (r.stdout !== want || 'code' in r) { out.push(`${f} ${flag}: ${'code' in r ? `exit ${r.code}` : 'exit 0'}, and it ${r.stdout === want ? 'printed its header' : `printed ${JSON.stringify(r.stdout.slice(0, 60))}, not its header`}`); }
			}
			out.push(...run('bash', ['-n', file]).map(l => `${f}: ${l}`));
			return out;
		}));
		problems.push(...runs.flat());
		// The commands dp.ts dispatches: every dp-*.ts exports an xxxCommands table.
		const commands: string[] = [];
		for (const file of ts(scripts).filter(f => /\/dp-[\w-]+\.ts$/.test(f))) {
			const mod = await import(file) as Record<string, unknown>;
			for (const [k, v] of Object.entries(mod)) { if (k.endsWith('Commands') && v) { commands.push(...Object.keys(v)); } }
		}
		const dp = readFileSync(join(scripts, 'dp.ts'), 'utf8');
		for (const c of commands) {
			if (!existsSync(join(scripts, `${c}.sh`))) { problems.push(`dp.ts ${c}: no ${c}.sh`); }
		}
		for (const m of dp.matchAll(/\.\.\.(\w+Commands)/g)) {
			if (!dp.includes(`import { ${m[1]} }`)) { problems.push(`dp.ts spreads ${m[1]} but does not import it`); }
		}
		if (commands.length < 15) { problems.push(`only ${commands.length} commands found in dp-*.ts`); }
		return problems;
	},

	registry: () => {
		const problems: string[] = [];
		const files = readdirSync(scripts).filter(f => /\.(ts|sh)$/.test(f) && f !== 'selectors.ts');
		const texts = files.map(f => ({ f, lines: readFileSync(join(scripts, f), 'utf8').split('\n') }));
		// A class or test-id selector written into a helper, rather than read from selectors.ts.
		const literals = [
			/(querySelector(All)?|locator|closest|matches)(<\w+>)?\(['"`]([^'"`]*[\s,(>])?[.#][a-zA-Z]/, // a class or an id
			/\[data-testid\^?=["']?[a-z]/, // a test id
			/\[class\*?=["']?[a-z]/,
			/classList\.contains\(['"`]/,
			/getAttribute\(['"`]data-(?!testid|dp-)/, // a product attribute
		];
		for (const { f, lines } of texts) {
			lines.forEach((l, i) => { if (literals.some(re => re.test(l))) { problems.push(`${f}:${i + 1}: a selector written in place; put it in selectors.ts: ${l.trim().slice(0, 100)}`); } });
		}
		// Every entry is read somewhere: as .key in code, or as group_key in bash.
		const all = texts.map(t => t.lines.join('\n')).join('\n');
		for (const [kind, groups] of [['css', css], ['names', names]] as const) {
			for (const [g, entries] of Object.entries(groups)) {
				for (const k of Object.keys(entries)) {
					if (!new RegExp(`\\.${k}\\b|\\b${g}_${k}\\b`).test(all)) { problems.push(`selectors.ts ${kind}.${g}.${k}: not read by any helper`); }
				}
			}
		}
		return problems;
	},

	drift: () => drift(repo).filter(r => r.status === 'MISSING').flatMap(describe),
};

let failed = 0;
for (const [name, fn] of Object.entries(checks)) {
	const t = Date.now();
	let problems: string[];
	try { problems = await fn(); } catch (e) { problems = [`threw: ${String(e)}`]; }
	const ms = Date.now() - t;
	console.log(`${problems.length ? 'FAIL' : 'PASS'} ${name.padEnd(8)} ${String(ms).padStart(5)} ms${problems.length ? `  ${problems.length} problem(s)` : ''}`);
	for (const p of problems.slice(0, 40)) { console.log(`     ${p}`); }
	if (problems.length) { failed++; }
}
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exitCode = failed ? 1 : 0;
