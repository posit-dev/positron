/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { parseMergeOutput } from './mergeTree';

/**
 * Output of `git merge-tree --write-tree -z` (git 2.54) recorded from real conflicts, with NUL
 * written as `|`. Ours had: text.txt and add.txt edited, bin.dat changed, ed.txt edited, ren.txt
 * renamed to ren-ours.txt, the file ff replaced by a folder, rd.txt renamed to rd-ours.txt.
 * Theirs had: text.txt and add.txt edited, bin.dat changed, ed.txt deleted, ren.txt renamed to
 * ren-theirs.txt, ff edited, rd.txt deleted.
 */
const MIXED = [
	'37c03b5938e8bc52183db9ed75ae0cc97889e73f',
	'100644 acc4f05ada5d98d04c62e2ee8c292018c412b2c6 2\tadd.txt',
	'100644 279ab66405d14412e54abe49d0f57e37c64ffa26 3\tadd.txt',
	'100644 0a5043e59fa24f63b9c638a74fa18639e0558d69 1\tbin.dat',
	'100644 78d345fe3aad19422d963b3709379302a09abf16 2\tbin.dat',
	'100644 778e41ca0a08274986fbc364c609c99e6ad06dc2 3\tbin.dat',
	'100644 2fa992c0b8b5c6acd2bdd4fa31de29d29799bdd5 1\ted.txt',
	'100644 7663aa741bec2b1328630882586fb7a2cbc8a255 2\ted.txt',
	'100644 fcd15acf93cad34ac127b658f4e16be63a12e915 1\tff~theirs',
	'100644 ee8da06837efc96aa17da9b73f6d914a42d17d2a 3\tff~theirs',
	'100644 6f349d04af8e917d929584020ba2a094695a4ee4 1\trd-ours.txt',
	'100644 6f349d04af8e917d929584020ba2a094695a4ee4 2\trd-ours.txt',
	'100644 9d80ddb4cc7365318accecc8f8084993ecf72e69 2\tren-ours.txt',
	'100644 9d80ddb4cc7365318accecc8f8084993ecf72e69 3\tren-theirs.txt',
	'100644 9d80ddb4cc7365318accecc8f8084993ecf72e69 1\tren.txt',
	'100644 f0f23074642919bb50ab5b6e4ec489706127f061 1\ttext.txt',
	'100644 e82fd36764c4f492d4bea29e5ef9c6b8b0335e03 2\ttext.txt',
	'100644 e9ffce59b94f4644f92b54ba2efd439af2452317 3\ttext.txt',
	'',
	'1', 'add.txt', 'Auto-merging', 'Auto-merging add.txt\n',
	'1', 'add.txt', 'CONFLICT (contents)', 'CONFLICT (add/add): Merge conflict in add.txt\n',
	'1', 'bin.dat', 'CONFLICT (binary)', 'warning: Cannot merge binary files: bin.dat (ours vs. theirs)\n',
	'1', 'bin.dat', 'Auto-merging', 'Auto-merging bin.dat\n',
	'1', 'bin.dat', 'CONFLICT (contents)', 'CONFLICT (content): Merge conflict in bin.dat\n',
	'1', 'ed.txt', 'CONFLICT (modify/delete)', 'CONFLICT (modify/delete): ed.txt deleted in theirs and modified in ours.  Version ours of ed.txt left in tree.\n',
	'2', 'ff~theirs', 'ff', 'CONFLICT (file/directory)', 'CONFLICT (file/directory): directory in the way of ff from theirs; moving it to ff~theirs instead.\n',
	'1', 'ff~theirs', 'CONFLICT (modify/delete)', 'CONFLICT (modify/delete): ff~theirs deleted in ours and modified in theirs.  Version theirs of ff~theirs left in tree.\n',
	'2', 'rd-ours.txt', 'rd.txt', 'CONFLICT (rename/delete)', 'CONFLICT (rename/delete): rd.txt renamed to rd-ours.txt in ours, but deleted in theirs.\n',
	'3', 'ren.txt', 'ren-ours.txt', 'ren-theirs.txt', 'CONFLICT (rename/rename)', 'CONFLICT (rename/rename): ren.txt renamed to ren-ours.txt in ours and to ren-theirs.txt in theirs.\n',
	'1', 'text.txt', 'Auto-merging', 'Auto-merging text.txt\n',
	'1', 'text.txt', 'CONFLICT (contents)', 'CONFLICT (content): Merge conflict in text.txt\n',
	'',
].join('\0');

/** Recorded the same way: a submodule both sides moved, a link on one side and a file on the other, and an executable file against a plain one. */
const SUBMODULE_AND_MODES = [
	'37ed8ce1b281aab250cc80ad6208476c8f17cd61',
	'120000 1de565933b05f74c75ff9a6520af5f9f8a5a2f1d 2\tlnk',
	'100644 0e0440721dff92b03ca19673de2a32183873033c 3\tlnk~theirs',
	'100755 28ce6a8b26aa170e1de65536fe8abe1832bd3242 2\tmodes',
	'100644 08bb2331e777f431177c40df6841c0034f89fb58 3\tmodes',
	'160000 1111111111111111111111111111111111111111 1\tsub',
	'160000 2222222222222222222222222222222222222222 2\tsub',
	'160000 3333333333333333333333333333333333333333 3\tsub',
	'',
	'2', 'lnk', 'lnk~theirs', 'CONFLICT (distinct modes)', 'CONFLICT (distinct types): lnk had different types on each side; renamed one of them so each can be recorded somewhere.\n',
	'1', 'modes', 'Auto-merging', 'Auto-merging modes\n',
	'1', 'modes', 'CONFLICT (contents)', 'CONFLICT (add/add): Merge conflict in modes\n',
	'1', 'sub', 'CONFLICT (submodule not initialized)', 'Failed to merge submodule sub (not checked out)\n',
	'1', 'sub', 'CONFLICT (contents)', 'CONFLICT (submodule): Merge conflict in sub\n',
	'',
].join('\0');

describe('parseMergeOutput', () => {
	test('reads the tree, the stages of each conflicted path, and every message', () => {
		const parsed = parseMergeOutput(MIXED);

		expect(parsed.tree).toBe('37c03b5938e8bc52183db9ed75ae0cc97889e73f');
		expect([...parsed.stages.keys()]).toEqual(['add.txt', 'bin.dat', 'ed.txt', 'ff~theirs', 'rd-ours.txt', 'ren-ours.txt', 'ren-theirs.txt', 'ren.txt', 'text.txt']);
		expect([...parsed.stages.get('ed.txt')!.keys()]).toEqual([1, 2]);
		expect(parsed.stages.get('text.txt')!.get(3)).toEqual({ mode: '100644', oid: 'e9ffce59b94f4644f92b54ba2efd439af2452317' });
		expect(parsed.messages.map(message => [message.paths, message.type])).toEqual([
			[['add.txt'], 'Auto-merging'],
			[['add.txt'], 'CONFLICT (contents)'],
			[['bin.dat'], 'CONFLICT (binary)'],
			[['bin.dat'], 'Auto-merging'],
			[['bin.dat'], 'CONFLICT (contents)'],
			[['ed.txt'], 'CONFLICT (modify/delete)'],
			[['ff~theirs', 'ff'], 'CONFLICT (file/directory)'],
			[['ff~theirs'], 'CONFLICT (modify/delete)'],
			[['rd-ours.txt', 'rd.txt'], 'CONFLICT (rename/delete)'],
			[['ren.txt', 'ren-ours.txt', 'ren-theirs.txt'], 'CONFLICT (rename/rename)'],
			[['text.txt'], 'Auto-merging'],
			[['text.txt'], 'CONFLICT (contents)'],
		]);
		expect(parsed.messages[1].text).toBe('CONFLICT (add/add): Merge conflict in add.txt');
	});

	test('reads submodule and mode conflicts', () => {
		const parsed = parseMergeOutput(SUBMODULE_AND_MODES);

		expect(parsed.stages.get('sub')!.get(2)).toEqual({ mode: '160000', oid: '2222222222222222222222222222222222222222' });
		expect(parsed.messages.map(message => message.type)).toEqual([
			'CONFLICT (distinct modes)', 'Auto-merging', 'CONFLICT (contents)', 'CONFLICT (submodule not initialized)', 'CONFLICT (contents)',
		]);
	});

	test('a clean merge is only a tree', () => {
		expect(parseMergeOutput('4b825dc642cb6eb9a060e54bf8d69288fbee4904\0')).toEqual({ tree: '4b825dc642cb6eb9a060e54bf8d69288fbee4904', stages: new Map(), messages: [] });
	});

	test('an unreadable conflicted entry throws', () => {
		expect(() => parseMergeOutput('4b825dc642cb6eb9a060e54bf8d69288fbee4904\0not an entry\0\0')).toThrow(/unreadable/);
	});
});
