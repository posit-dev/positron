/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

const encoder = new TextEncoder();

/**
 * MurmurHash2 non-cryptographic hash function.
 *
 * Ported from the MIT-licensed garycourt/murmurhash-js repo by Gary Court
 * to use NodeJS's TextEncoder to match the ipykernel implementation.
 *
 * @author <a href="mailto:gary.court@gmail.com">Gary Court</a>
 * @see http://github.com/garycourt/murmurhash-js
 * @author <a href="mailto:aappleby@gmail.com">Austin Appleby</a>
 * @see http://sites.google.com/site/murmurhash/
 *
 * @param str Input string to hash.
 * @param seed Positive integer seed.
 * @return 32-bit positive integer hash.
 */
export function murmurhash2_32(str: string, seed: number): number {
	const bytes = encoder.encode(str);
	let
		l = bytes.length,
		h = seed ^ l,
		i = 0;

	while (l >= 4) {
		let k =
			((bytes[i] & 0xff)) |
			((bytes[++i] & 0xff) << 8) |
			((bytes[++i] & 0xff) << 16) |
			((bytes[++i] & 0xff) << 24);

		k = (((k & 0xffff) * 0x5bd1e995) + ((((k >>> 16) * 0x5bd1e995) & 0xffff) << 16));
		k ^= k >>> 24;
		k = (((k & 0xffff) * 0x5bd1e995) + ((((k >>> 16) * 0x5bd1e995) & 0xffff) << 16));

		h = (((h & 0xffff) * 0x5bd1e995) + ((((h >>> 16) * 0x5bd1e995) & 0xffff) << 16)) ^ k;

		l -= 4;
		++i;
	}

	switch (l) {
		case 3: h ^= (bytes[i + 2] & 0xff) << 16;
		case 2: h ^= (bytes[i + 1] & 0xff) << 8;
		case 1: h ^= (bytes[i] & 0xff);
			h = (((h & 0xffff) * 0x5bd1e995) + ((((h >>> 16) * 0x5bd1e995) & 0xffff) << 16));
	}

	h ^= h >>> 13;
	h = (((h & 0xffff) * 0x5bd1e995) + ((((h >>> 16) * 0x5bd1e995) & 0xffff) << 16));
	h ^= h >>> 15;

	return h >>> 0;
}
