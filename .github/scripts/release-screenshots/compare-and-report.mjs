// Copyright (c) Posit Software, PBC.

import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function sha256(buf) {
	return createHash('sha256').update(buf).digest('hex');
}

async function readPng(path) {
	const buf = await readFile(path);
	if (buf.length === 0) {
		throw new Error(`PNG is empty: ${path}`);
	}
	if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIG)) {
		throw new Error(`File is not a valid PNG (bad signature): ${path}`);
	}
	return buf;
}

async function readPngIfExists(path) {
	try {
		return await readPng(path);
	} catch (err) {
		if (err.code === 'ENOENT') {
			return null;
		}
		throw err;
	}
}

export async function classify(generatedDir, docsDir) {
	const entries = await readdir(generatedDir);
	const result = {};
	for (const name of entries) {
		if (!name.endsWith('.png')) {
			continue;
		}
		const genBuf = await readPng(join(generatedDir, name));
		const generatedHash = await sha256(genBuf);
		const docsBuf = await readPngIfExists(join(docsDir, name));
		if (docsBuf === null) {
			result[name] = { status: 'new', generatedHash, generatedSize: genBuf.length };
			continue;
		}
		const docsHash = await sha256(docsBuf);
		const status = generatedHash === docsHash ? 'unchanged' : 'changed';
		result[name] = { status, generatedHash, generatedSize: genBuf.length, docsHash };
	}
	return result;
}
