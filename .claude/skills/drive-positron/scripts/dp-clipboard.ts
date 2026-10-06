/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// clipboard: the machine's clipboard, read outside the page (a copy made in
// Positron, such as Copy Plot to Clipboard, lands there). macOS only, through
// osascript's JavaScript and the AppKit pasteboard. clipboard.sh wraps it.

import { execFileSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { Exit, log, logRead, parse, usage, type Json } from './dp-lib.ts';

// The pasteboard's types and text; with a path, its image written there as a
// PNG (a TIFF converted), with its size. Run by osascript -l JavaScript.
const jxa = `
ObjC.import('AppKit');
function run(argv) {
	const pb = $.NSPasteboard.generalPasteboard;
	const types = ObjC.deepUnwrap(pb.types) || [];
	const text = pb.stringForType($.NSPasteboardTypeString);
	const out = { types: types, text: text.isNil() ? null : ObjC.unwrap(text) };
	if (argv[0]) {
		let data = pb.dataForType($.NSPasteboardTypePNG);
		if (data.isNil()) { data = pb.dataForType($.NSPasteboardTypeTIFF); }
		if (data.isNil()) { out.image = null; return JSON.stringify(out); }
		const rep = $.NSBitmapImageRep.imageRepWithData(data);
		const png = rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $());
		out.image = { written: png.writeToFileAtomically(argv[0], true), bytes: Number(png.length), width: Number(rep.pixelsWide), height: Number(rep.pixelsHigh) };
	}
	return JSON.stringify(out);
}`;

export const clipboardCommands: Record<string, (argv: string[]) => Json | string> = {
	clipboard: argv => {
		const p = parse(argv, ['session', 'image'], 1);
		if (p.flags.help || !p.rest[0]) { usage('clipboard.sh'); }
		if (p.rest[0] !== 'read') { throw new Exit(2, { ok: false, error: 'command: read [--image FILE]' }); }
		if (process.platform !== 'darwin') { return { ok: false, error: `clipboard.sh reads the clipboard on macOS only (osascript); this is ${process.platform}, so nothing was read` }; }
		const file = typeof p.flags.image === 'string' ? p.flags.image : '';
		if (p.flags.image !== undefined && !file) { throw new Exit(2, { ok: false, error: '--image takes the file to write, such as clip-01.png' }); }
		// A bare name goes in the run's shots folder, as shot.sh's does, and is never overwritten.
		const path = !file ? '' : file.includes('/') ? resolve(file) : join(process.env.DRIVE_POSITRON_SHOTS ?? '.', file);
		if (path && existsSync(path)) { return { ok: false, error: `${path} already exists; give another name` }; }
		if (path) { mkdirSync(dirname(path), { recursive: true }); }
		let r: { types: string[]; text: string | null; image?: { written: boolean; bytes: number; width: number; height: number } | null };
		try {
			r = JSON.parse(execFileSync('osascript', ['-l', 'JavaScript', '-e', jxa, ...(path ? [path] : [])], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
		} catch (e) {
			return { ok: false, error: `osascript failed: ${String((e as { stderr?: string }).stderr || (e as Error).message).trim().split('\n')[0]}` };
		}
		const text = r.text === null ? null : r.text.length > 10000 ? r.text.slice(0, 10000) : r.text;
		const base = { types: r.types, text, ...(r.text && r.text.length > 10000 ? { length: r.text.length, note: 'the text is cut to its first 10000 characters' } : {}) };
		if (!path) {
			logRead('clipboard.sh', p.session, `clipboard: ${text === null ? 'no text' : JSON.stringify(text)}; types ${r.types.join(', ')}`);
			return { ok: true, ...base };
		}
		if (!r.image) { return { ok: false, error: 'the clipboard holds no image (no PNG or TIFF); nothing was written', ...base }; }
		if (!r.image.written || !existsSync(path)) { return { ok: false, error: `the clipboard's image could not be written to ${path}` }; }
		const image = { path, bytes: r.image.bytes, width: r.image.width, height: r.image.height };
		log('clipboard.sh', p.session, `save the clipboard's image as ${path.split('/').pop()}`, `${image.width}x${image.height} px, ${image.bytes} bytes`);
		return { ok: true, ...base, image };
	},
};
