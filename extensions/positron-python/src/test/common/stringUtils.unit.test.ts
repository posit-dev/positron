// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { expect } from 'chai';
import '../../client/common/extensions';
// --- Start Positron ---
import { getShortestString, replaceAll } from '../../client/common/stringUtils';
// --- End Positron ---

suite('String Extensions', () => {
    test('String should replace all substrings with new substring', () => {
        const oldString = `foo \\ foo \\ foo`;
        const expectedString = `foo \\\\ foo \\\\ foo`;
        const oldString2 = `\\ foo \\ foo`;
        const expectedString2 = `\\\\ foo \\\\ foo`;
        const oldString3 = `\\ foo \\`;
        const expectedString3 = `\\\\ foo \\\\`;
        const oldString4 = `foo foo`;
        const expectedString4 = `foo foo`;
        expect(replaceAll(oldString, '\\', '\\\\')).to.be.equal(expectedString);
        expect(replaceAll(oldString2, '\\', '\\\\')).to.be.equal(expectedString2);
        expect(replaceAll(oldString3, '\\', '\\\\')).to.be.equal(expectedString3);
        expect(replaceAll(oldString4, '\\', '\\\\')).to.be.equal(expectedString4);
    });
});

// --- Start Positron ---
suite('getShortestString', () => {
    test('returns the shortest string', () => {
        expect(getShortestString(['aaa', 'a', 'aa'])).to.be.equal('a');
    });

    test('returns the only string', () => {
        expect(getShortestString(['aaa'])).to.be.equal('aaa');
    });

    test('breaks equal-length ties lexicographically', () => {
        expect(getShortestString(['bbb', 'aaa'])).to.be.equal('aaa');
    });

    test('equal-length result does not depend on argument order', () => {
        // Two interpreter paths of the same length that reach the same
        // interpreter. An order-dependent winner here lets each path displace
        // the other indefinitely, which spins the locator forever.
        const a = '/opt/python/default/bin/python';
        const b = '/opt/python/3.11.13/bin/python';
        expect(a.length).to.be.equal(b.length);
        expect(getShortestString([a, b])).to.be.equal(getShortestString([b, a]));
    });

    test('prefers a shorter path over a lexicographically earlier one', () => {
        expect(getShortestString(['/opt/z/python', '/opt/aaaa/python'])).to.be.equal('/opt/z/python');
    });
});
// --- End Positron ---
