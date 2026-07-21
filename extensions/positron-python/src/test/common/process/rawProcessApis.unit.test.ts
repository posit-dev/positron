// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { expect } from 'chai';
import * as sinon from 'sinon';
import { ChildProcess } from 'child_process';
import { execObservable } from '../../../client/common/process/rawProcessApis';
import { Output } from '../../../client/common/process/types';
import { MockChildProcess } from '../../mocks/mockChildProcess';

// Stub the raw required module (what rawProcessApis calls), not the
// `import * as` namespace wrapper, whose getters are non-configurable.
// Use a `require()` call rather than `import = require` so it compiles under
// the ESM-target build too (import-assignment is a TS1202 error there).
const childProcess: typeof import('child_process') = require('child_process');

suite('execObservable - trailing output', () => {
    let proc: MockChildProcess;

    setup(() => {
        proc = new MockChildProcess('python', ['create_venv.py']);
        sinon.stub(childProcess, 'spawn').returns(proc as unknown as ChildProcess);
    });

    teardown(() => {
        sinon.restore();
    });

    // Reproduces the venv "Failed to create virtual environment" flake: a child
    // process's final stdout line (create_venv.py's `CREATED_VENV:` marker) is
    // produced and the process exits 0, but the chunk lands after the `exit`
    // event. Node emits `exit` before the stdout pipe finishes draining (`close`
    // is the drain-complete event), so if execObservable completes on `exit` the
    // trailing chunk is dropped. Asserts the marker is delivered, so it fails
    // against the current `exit`-completes code and passes once completion waits
    // for `close`.
    test('delivers a stdout chunk that arrives after the process exit event', (done) => {
        const received: string[] = [];
        const result = execObservable('python', ['create_venv.py'], { doNotLog: true });

        result.out.subscribe(
            (value: Output<string>) => received.push(value.out),
            (err) => done(err),
            () => {
                try {
                    expect(received.join('')).to.contain(
                        'CREATED_VENV:',
                        'the stdout chunk emitted after the exit event was dropped',
                    );
                    done();
                } catch (ex) {
                    done(ex);
                }
            },
        );

        // Model Node's real ordering under load: some output, then the process
        // exit, then the final buffered stdout chunk drains, then close.
        proc.stdout!.emit('data', Buffer.from('Running: python -m venv .venv\n'));
        proc.emit('exit', 0, null);
        proc.stdout!.emit('data', Buffer.from('CREATED_VENV:/tmp/x/.venv/bin/python\n'));
        proc.emit('close', 0, null);
    });
});
