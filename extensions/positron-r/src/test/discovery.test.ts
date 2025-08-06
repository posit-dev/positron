/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './mocha-setup'

import * as assert from 'assert';
import * as Fs from "fs";
import * as Sinon from 'sinon';
import { currentRBinaryFromPATHWindows } from '../provider';
import path = require('path');

function createReadFileSyncStub(returnValue: string | Buffer): Sinon.SinonStub {
	return Sinon.stub(Fs, "readFileSync").callsFake((path: number | Fs.PathLike, options?: any): string | Buffer => {
		if (typeof options === 'string' || options === null || options === undefined) {
			return returnValue as string;
		} else if (options && typeof options === 'object' && 'encoding' in options) {
			return returnValue as string;
		}
		return Buffer.from(returnValue as string);
	});
}

// These fail randomly when run with "npm run".  They were fine when run with "yarn"
suite.skip('Discovery', () => {

	let pathSepStub: Sinon.SinonStub;
	let readFileSyncStub: Sinon.SinonStub;
	let existsSyncStub: Sinon.SinonStub;
	let pathJoinStub: Sinon.SinonStub;

	suiteSetup(function () {
		this.originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');

		Object.defineProperty(process, 'platform', {
			value: 'win32'
		});

		existsSyncStub = Sinon.stub(Fs, 'existsSync').returns(true);

		pathSepStub = Sinon.stub(path, 'sep').value('\\\\');

		pathJoinStub = Sinon.stub(path, 'join').callsFake((...args: string[]) => {
			return args.join('\\\\');
		});

	});

	suiteTeardown(function () {
		Object.defineProperty(process, 'platform', this.originalPlatform);
		existsSyncStub.restore();
		pathSepStub.restore();
		pathJoinStub.restore();
	});

	suite('Discovery - C:\\Program Files\\R\\R-4.3.2\\bin\\x64\\R.exe', () => {

		const r432 = 'C:\\\\Program Files\\\\R\\\\R-4.3.2\\\\bin\\\\x64\\\\R.exe';

		suiteSetup(function () {
			readFileSyncStub = createReadFileSyncStub(r432);
		});

		suiteTeardown(function () {
			readFileSyncStub.restore();
		});

		test('Find R on Windows path', async () => {
			const result = await currentRBinaryFromPATHWindows(r432);
			assert.strictEqual(result?.path, r432);
		});
	});

	suite('Discovery - C:\\Program Files\\R\\bin\\R.BAT', () => {

		const rbat = 'C:\\\\Program Files\\\\R\\\\bin\\\\R.BAT';

		suiteSetup(function () {
			readFileSyncStub = createReadFileSyncStub(rbat);
		});

		suiteTeardown(function () {
			readFileSyncStub.restore();
		});

		test('Find R on Windows path', async () => {
			const result = await currentRBinaryFromPATHWindows(rbat);
			assert.strictEqual(result, undefined);
		});
	});

	suite('Discovery - C:\\Program Files\\R\\R-4.3.2\\bin\\R.exe with x64 version', () => {

		const x64 = 'C:\\\\Program Files\\\\R\\\\R-4.3.2\\\\bin\\\\x64\\\\R.exe';
		const smartshim = 'C:\\\\Program Files\\\\R\\\\R-4.3.2\\\\bin\\\\R.exe';

		suiteSetup(function () {
			readFileSyncStub = createReadFileSyncStub(smartshim);
		});

		suiteTeardown(function () {
			readFileSyncStub.restore();
		});

		test('Find R on Windows path', async () => {
			const result = await currentRBinaryFromPATHWindows(smartshim);
			assert.strictEqual(result?.path, x64);
		});
	});
});
