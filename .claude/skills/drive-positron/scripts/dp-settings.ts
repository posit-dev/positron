/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// A setting written into the instance's own settings.json, the user's (the
// run's disposable profile) or the open folder's .vscode/settings.json,
// merged in with jsonc-parser so the file's other settings and comments stay.
// The page says where both files are: the window's configuration names the
// profile's settings file and the folder, as URIs that fsPath turns into file
// paths (/c:/... is c:\... on Windows). A folder that is not on this machine
// (a remote window) is refused, not written. settings.sh wraps this.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { applyEdits, modify, parse as parseJsonc, type ParseError } from 'jsonc-parser';
import { commandWord, Exit, fsPath, inPage, log, parse, shownPath, usage, type Json, type PageFn, type UriParts } from './dp-lib.ts';

/**
 * The user settings file and the open folder, from the window's configuration
 * (the preload's vscode.context), which has no role or name to read instead.
 * runs in run-code
 */
const paths: PageFn<Record<string, never>> = async page => page.evaluate(() => {
	type Uri = { scheme?: string; authority?: string; path?: string };
	const c = (globalThis as unknown as { vscode?: { context?: { configuration?: () => { profiles?: { profile?: { settingsResource?: Uri } }; workspace?: { uri?: Uri; configPath?: Uri } } } } })
		.vscode?.context?.configuration?.();
	if (!c) { return { ok: false, error: 'the window does not expose its configuration' }; }
	const parts = (u?: Uri) => u?.path ? { scheme: u.scheme, authority: u.authority, path: u.path } : null;
	return { ok: true, user: parts(c.profiles?.profile?.settingsResource), folder: parts(c.workspace?.uri), workspaceFile: parts(c.workspace?.configPath) };
});

/** VALUE as JSON when it parses (true, 3, "x", [1]), else as the string it is. */
function value(text: string): unknown {
	try { return JSON.parse(text); } catch { return text; }
}

export const settingsCommands: Record<string, (argv: string[]) => Json | string> = {
	settings: argv => {
		const p = parse(argv, ['session'], { set: 3 }, ['user', 'workspace']);
		const [cmd, key, raw] = p.rest;
		if (p.flags.help || !cmd) { usage('settings.sh'); }
		commandWord(cmd, ['set KEY VALUE']);
		if (!key || raw === undefined) { throw new Exit(2, { ok: false, error: 'give the KEY and the VALUE' }); }
		if (p.flags.user && p.flags.workspace) { throw new Exit(2, { ok: false, error: '--user or --workspace, not both' }); }
		const where = p.flags.user ? 'user' : 'workspace';
		const w = inPage(p.session, paths, {});
		if (!w.ok) { return w; }
		let file: string;
		if (where === 'user') {
			const user = w.user as UriParts | null;
			if (!user) { return { ok: false, error: 'the window names no user settings file' }; }
			// The desktop app names the profile's files with vscode-userdata:,
			// which it maps to the file of the same path.
			const onDisk = fsPath(user.scheme === 'vscode-userdata' ? { ...user, scheme: 'file' } : user);
			if (!onDisk) { return { ok: false, error: `the user settings file is ${shownPath(user)}, not a file on this machine: not written` }; }
			file = onDisk;
		} else {
			const workspaceFile = w.workspaceFile as UriParts | null, folder = w.folder as UriParts | null;
			if (workspaceFile) { return { ok: false, error: `the window has a .code-workspace open (${shownPath(workspaceFile)}); its settings are in that file: not written` }; }
			if (!folder) { return { ok: false, error: 'no folder is open, so there is no workspace settings file; use --user' }; }
			const onDisk = fsPath(folder);
			if (!onDisk) { return { ok: false, error: `the folder is ${shownPath(folder)}, not on this machine (a remote window?); its settings are not written` }; }
			file = join(onDisk, '.vscode', 'settings.json');
		}
		const text = existsSync(file) ? readFileSync(file, 'utf8') : '{}\n';
		const errors: ParseError[] = [];
		parseJsonc(text, errors, { allowTrailingComma: true });
		if (errors.length) { return { ok: false, error: `${file} does not parse as JSON with comments (error at offset ${errors[0].offset}); not written`, file }; }
		const v = value(raw);
		const written = applyEdits(text, modify(text, [key], v, { formattingOptions: { insertSpaces: false, tabSize: 1, eol: '\n' } }));
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, written);
		// Read back from disk: what the app's file watcher will see.
		const back = (parseJsonc(readFileSync(file, 'utf8'), [], { allowTrailingComma: true }) as Record<string, unknown>)[key];
		if (JSON.stringify(back) !== JSON.stringify(v)) { return { ok: false, error: `${file} reads ${JSON.stringify(back)} for ${key} after writing`, file }; }
		log('settings.sh', p.session, `set ${key} = ${JSON.stringify(v)} in ${where} settings`);
		return { ok: true, key, value: v, scope: where, file };
	},
};
