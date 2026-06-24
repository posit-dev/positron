/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { expect } from 'chai';
import {
    buildPinnedRequirements,
    extractRequirementName,
    normalizePackageName,
} from '../../client/positron/packages/requirementsFile';

suite('requirementsFile Tests', () => {
    suite('normalizePackageName', () => {
        test('lowercases and collapses separators per PEP 503', () => {
            expect(normalizePackageName('Flask')).to.equal('flask');
            expect(normalizePackageName('typing_extensions')).to.equal('typing-extensions');
            expect(normalizePackageName('zope.interface')).to.equal('zope-interface');
            expect(normalizePackageName('Foo--_.Bar')).to.equal('foo-bar');
        });
    });

    suite('extractRequirementName', () => {
        test('reads the name from a pinned spec', () => {
            expect(extractRequirementName('Werkzeug==2.0.3')).to.equal('Werkzeug');
        });

        test('reads the name from a direct-reference spec', () => {
            expect(extractRequirementName('positron-update-demo @ file:///tmp/demo')).to.equal(
                'positron-update-demo',
            );
        });

        test('ignores comments, blanks, options, and editables', () => {
            expect(extractRequirementName('')).to.equal(undefined);
            expect(extractRequirementName('   ')).to.equal(undefined);
            expect(extractRequirementName('# a comment')).to.equal(undefined);
            expect(extractRequirementName('--index-url https://example.com')).to.equal(undefined);
            expect(extractRequirementName('-e /path/to/pkg')).to.equal(undefined);
        });
    });

    suite('buildPinnedRequirements', () => {
        test('replaces only the target line and preserves the rest in order', () => {
            const lines = ['flask==2.2.0', 'Werkzeug==2.0.3', 'positron-update-demo @ file:///tmp/demo'];
            const result = buildPinnedRequirements(lines, [{ name: 'werkzeug', version: '3.1.8' }]);
            expect(result).to.equal(
                ['flask==2.2.0', 'werkzeug==3.1.8', 'positron-update-demo @ file:///tmp/demo'].join('\n') + '\n',
            );
        });

        test('matches the target case-insensitively on the normalized name', () => {
            const lines = ['Typing_Extensions==4.0.0'];
            const result = buildPinnedRequirements(lines, [{ name: 'typing-extensions', version: '4.9.0' }]);
            expect(result).to.equal('typing-extensions==4.9.0\n');
        });

        test('replaces multiple targets for update-all', () => {
            const lines = ['flask==2.2.0', 'werkzeug==2.0.3', 'requests==2.28.0'];
            const result = buildPinnedRequirements(lines, [
                { name: 'flask', version: '3.0.0' },
                { name: 'requests', version: '2.31.0' },
            ]);
            expect(result).to.equal(['flask==3.0.0', 'werkzeug==2.0.3', 'requests==2.31.0'].join('\n') + '\n');
        });

        test('filters the pkg-resources==0.0.0 junk line', () => {
            const lines = ['pkg-resources==0.0.0', 'flask==2.2.0'];
            const result = buildPinnedRequirements(lines, [{ name: 'flask', version: '3.0.0' }]);
            expect(result).to.equal('flask==3.0.0\n');
        });

        test('appends a target that is absent from the freeze output', () => {
            const lines = ['flask==2.2.0'];
            const result = buildPinnedRequirements(lines, [{ name: 'requests', version: '2.31.0' }]);
            expect(result).to.equal(['flask==2.2.0', 'requests==2.31.0'].join('\n') + '\n');
        });

        test('uses a bare name when the target has no version', () => {
            const lines = ['flask==2.2.0'];
            const result = buildPinnedRequirements(lines, [{ name: 'flask' }]);
            expect(result).to.equal('flask\n');
        });
    });
});
