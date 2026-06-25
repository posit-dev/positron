/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { expect } from 'chai';
import {
    buildRequirementsFile,
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

    suite('buildRequirementsFile', () => {
        test('bare-names plain PyPI pins and pins the target', () => {
            const lines = ['flask==2.2.0', 'Werkzeug==2.0.3', 'positron-update-demo @ file:///tmp/demo'];
            const result = buildRequirementsFile(lines, [{ name: 'werkzeug', version: '3.1.8' }]);
            expect(result).to.equal(
                ['flask', 'werkzeug==3.1.8', 'positron-update-demo @ file:///tmp/demo'].join('\n') + '\n',
            );
        });

        test('keeps origin lines (direct reference and editable) verbatim', () => {
            const lines = ['pkg @ file:///tmp/pkg', '-e /tmp/editable', 'requests==2.28.0'];
            const result = buildRequirementsFile(lines, []);
            expect(result).to.equal(['pkg @ file:///tmp/pkg', '-e /tmp/editable', 'requests'].join('\n') + '\n');
        });

        test('with no targets (Update All) leaves everything bare or verbatim', () => {
            const lines = ['flask==2.2.0', 'werkzeug==2.0.3'];
            const result = buildRequirementsFile(lines, []);
            expect(result).to.equal(['flask', 'werkzeug'].join('\n') + '\n');
        });

        test('matches the target case-insensitively on the normalized name', () => {
            const lines = ['Typing_Extensions==4.0.0'];
            const result = buildRequirementsFile(lines, [{ name: 'typing-extensions', version: '4.9.0' }]);
            expect(result).to.equal('typing-extensions==4.9.0\n');
        });

        test('pins multiple targets for a multi-package update', () => {
            const lines = ['flask==2.2.0', 'werkzeug==2.0.3', 'requests==2.28.0'];
            const result = buildRequirementsFile(lines, [
                { name: 'flask', version: '3.0.0' },
                { name: 'requests', version: '2.31.0' },
            ]);
            expect(result).to.equal(['flask==3.0.0', 'werkzeug', 'requests==2.31.0'].join('\n') + '\n');
        });

        test('filters the pkg-resources==0.0.0 junk line and blank lines', () => {
            const lines = ['pkg-resources==0.0.0', '', 'flask==2.2.0'];
            const result = buildRequirementsFile(lines, []);
            expect(result).to.equal('flask\n');
        });

        test('appends a target absent from the freeze output', () => {
            const lines = ['flask==2.2.0'];
            const result = buildRequirementsFile(lines, [{ name: 'requests', version: '2.31.0' }]);
            expect(result).to.equal(['flask', 'requests==2.31.0'].join('\n') + '\n');
        });
    });
});
