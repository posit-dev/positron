/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as crypto from 'crypto';
import {
	buildCanonicalRequest, generateKeyPair, generateTokenId, KeyAuthenticator, md5Checksum, rsaSha1Sign,
	signRequestWithChecksum, TokenAuthenticator,
} from '../connectAuth.js';

suite('connectAuth signing', () => {
	test('md5Checksum matches base64 MD5 of the body, empty for undefined', () => {
		assert.strictEqual(md5Checksum(undefined), crypto.createHash('md5').update('').digest('base64'));
		assert.strictEqual(md5Checksum('abc'), crypto.createHash('md5').update('abc').digest('base64'));
	});

	test('buildCanonicalRequest joins method, path, date, checksum with newlines', () => {
		assert.strictEqual(buildCanonicalRequest('GET', '/__api__/v1/user', 'DATE', 'SUM'), 'GET\n/__api__/v1/user\nDATE\nSUM');
	});

	test('rsaSha1Sign produces a signature that verifies against the matching public key', () => {
		const { privateKey, publicKey } = generateKeyPair();
		const canonical = buildCanonicalRequest('GET', '/__api__/v1/user', new Date().toUTCString(), md5Checksum(undefined));
		const signature = rsaSha1Sign(canonical, privateKey);
		const verifier = crypto.createVerify('SHA1');
		verifier.update(canonical);
		const ok = verifier.verify(
			crypto.createPublicKey({ key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' }),
			Buffer.from(signature, 'base64'),
		);
		assert.strictEqual(ok, true);
	});

	test('signRequestWithChecksum returns the four Connect auth headers', () => {
		const { privateKey } = generateKeyPair();
		const headers = signRequestWithChecksum('GET', '/__api__/v1/user', md5Checksum(undefined), 'T-token', privateKey);
		assert.deepStrictEqual(Object.keys(headers).sort(), ['Date', 'X-Auth-Signature', 'X-Auth-Token', 'X-Content-Checksum']);
		assert.strictEqual(headers['X-Auth-Token'], 'T-token');
		assert.strictEqual(headers['X-Content-Checksum'], md5Checksum(undefined));
	});

	test('generateTokenId is a T prefix plus 32 hex chars', () => {
		assert.match(generateTokenId(), /^T[0-9a-f]{32}$/);
	});

	test('generateKeyPair returns base64 DER keys usable by crypto', () => {
		const { privateKey, publicKey } = generateKeyPair();
		assert.doesNotThrow(() => crypto.createPrivateKey({ key: Buffer.from(privateKey, 'base64'), format: 'der', type: 'pkcs1' }));
		assert.doesNotThrow(() => crypto.createPublicKey({ key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' }));
	});
});

suite('connectAuth authenticators', () => {
	test('KeyAuthenticator sends only the Authorization: Key header, ignoring signing args', () => {
		const headers = new KeyAuthenticator('secret-key').headers('GET', '/__api__/v1/user', md5Checksum(undefined));
		assert.deepStrictEqual(headers, { 'Authorization': 'Key secret-key' });
	});

	test('TokenAuthenticator signs the request; the signature verifies for the given method and path', () => {
		const { privateKey, publicKey } = generateKeyPair();
		const auth = new TokenAuthenticator({ token: 'T-abc', privateKey });
		const checksum = md5Checksum(undefined);
		const headers = auth.headers('GET', '/__api__/v1/user', checksum);

		assert.strictEqual(headers['X-Auth-Token'], 'T-abc');
		const canonical = `GET\n/__api__/v1/user\n${headers['Date']}\n${checksum}`;
		const verifier = crypto.createVerify('SHA1');
		verifier.update(canonical);
		const ok = verifier.verify(
			crypto.createPublicKey({ key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' }),
			Buffer.from(headers['X-Auth-Signature'], 'base64'),
		);
		assert.strictEqual(ok, true);
	});
});
