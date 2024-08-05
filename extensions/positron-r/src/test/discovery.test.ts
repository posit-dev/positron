/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as Fs from "fs"
import * as Sinon from 'sinon';
import { findRBinaryFromPATHWindows } from '../provider';
import path = require('path');

suite('Discovery', () => {

	const r432 = 'C:\\\\Program Files\\\\R\\\\R-4.3.2\\\\bin\\\\x64\\\\R.exe';

	let pathSepStub: Sinon.SinonStub;
	let readFileSyncStub: Sinon.SinonStub;
	let existsSyncStub: Sinon.SinonStub;
	let pathJoinStub: Sinon.SinonStub;

	suiteSetup(function () {
		this.originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');

		Object.defineProperty(process, 'platform', {
			value: 'win32'
		});

		readFileSyncStub = Sinon.stub(Fs, "readFileSync").callsFake((path: number | Fs.PathLike, options?: any): string | Buffer => {
			if (typeof options === 'string' || options === null || options === undefined) {
				return r432;
			} else if (options && typeof options === 'object' && 'encoding' in options) {
				return r432;
			}
			return Buffer.from(r432);
		});

		existsSyncStub = Sinon.stub(Fs, 'existsSync').returns(true);

		pathSepStub = Sinon.stub(path, 'sep').value('\\');

		pathJoinStub = Sinon.stub(path, 'join').callsFake((...args: string[]) => {
			// Define the mock behavior, e.g., join paths with a custom separator
			return args.join('\\\\');
		  });

	});

	suiteTeardown(function () {
		Object.defineProperty(process, 'platform', this.originalPlatform);
		readFileSyncStub.restore();
		existsSyncStub.restore();
		pathSepStub.restore();
		pathJoinStub.restore();
	});


	test('Find R on Windows path', async () => {

		const result = await findRBinaryFromPATHWindows(r432);

		console.log(result);

		//assert (result === 'C:\\Program Files\\R\\R-4.3.2\\bin\\x64\\R.exe');

	});
});
