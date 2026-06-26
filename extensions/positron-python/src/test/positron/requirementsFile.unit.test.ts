/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { expect } from 'chai';
import { buildRequirementsFile, normalizePackageName } from '../../client/positron/packages/requirementsFile';

suite('requirementsFile Tests', () => {
    suite('normalizePackageName', () => {
        test('lowercases and collapses separators per PEP 503', () => {
            expect(normalizePackageName('Flask')).to.equal('flask');
            expect(normalizePackageName('typing_extensions')).to.equal('typing-extensions');
            expect(normalizePackageName('zope.interface')).to.equal('zope-interface');
            expect(normalizePackageName('Foo--_.Bar')).to.equal('foo-bar');
        });
    });

    suite('buildRequirementsFile', () => {
        test('pins the target and emits other names bare', () => {
            const names = ['flask', 'werkzeug', 'positron-update-demo'];
            const result = buildRequirementsFile(names, [{ name: 'werkzeug', version: '3.1.8' }]);
            expect(result).to.equal(['flask', 'werkzeug==3.1.8', 'positron-update-demo'].join('\n') + '\n');
        });

        test('matches target case-insensitively on normalized name', () => {
            const names = ['Typing_Extensions'];
            const result = buildRequirementsFile(names, [{ name: 'typing-extensions', version: '4.9.0' }]);
            expect(result).to.equal('typing-extensions==4.9.0\n');
        });

        test('versionless target is emitted as a bare name when matched', () => {
            const result = buildRequirementsFile(['requests'], [{ name: 'requests' }]);
            expect(result).to.equal('requests\n');
        });

        test('pins multiple targets for a multi-package update', () => {
            const names = ['flask', 'werkzeug', 'requests'];
            const result = buildRequirementsFile(names, [
                { name: 'flask', version: '3.0.0' },
                { name: 'requests', version: '2.31.0' },
            ]);
            expect(result).to.equal(['flask==3.0.0', 'werkzeug', 'requests==2.31.0'].join('\n') + '\n');
        });

        test('with no targets (Update All) emits all names bare', () => {
            const names = ['flask', 'werkzeug'];
            const result = buildRequirementsFile(names, []);
            expect(result).to.equal(['flask', 'werkzeug'].join('\n') + '\n');
        });

        test('appends a target absent from the installed names', () => {
            const result = buildRequirementsFile(['flask'], [{ name: 'requests', version: '2.31.0' }]);
            expect(result).to.equal(['flask', 'requests==2.31.0'].join('\n') + '\n');
        });

        test('appends a versionless target absent from the installed names as bare name', () => {
            const result = buildRequirementsFile(['flask'], [{ name: 'requests' }]);
            expect(result).to.equal(['flask', 'requests'].join('\n') + '\n');
        });

        test('skips blank and whitespace-only entries defensively', () => {
            const names = ['', '  ', 'flask'];
            const result = buildRequirementsFile(names, []);
            expect(result).to.equal('flask\n');
        });
    });
});
