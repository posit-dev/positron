/* eslint-disable no-unused-expressions */
/* eslint-disable @typescript-eslint/no-explicit-any */
import * as TypeMoq from 'typemoq';
import * as sinon from 'sinon';
import { Disposable } from 'vscode';
import { expect } from 'chai';

import { IInterpreterService } from '../../client/interpreter/contracts';
import { PythonEnvironment } from '../../client/pythonEnvironments/info';
import { getNativeRepl, NativeRepl } from '../../client/repl/nativeRepl';

suite('REPL - Native REPL', () => {
    let interpreterService: TypeMoq.IMock<IInterpreterService>;

    let disposable: TypeMoq.IMock<Disposable>;
    let disposableArray: Disposable[] = [];

    let setReplDirectoryStub: sinon.SinonStub;
    let setReplControllerSpy: sinon.SinonSpy;

    setup(() => {
        interpreterService = TypeMoq.Mock.ofType<IInterpreterService>();
        interpreterService
            .setup((i) => i.getActiveInterpreter(TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(({ path: 'ps' } as unknown) as PythonEnvironment));
        disposable = TypeMoq.Mock.ofType<Disposable>();
        disposableArray = [disposable.object];

        setReplDirectoryStub = sinon.stub(NativeRepl.prototype as any, 'setReplDirectory').resolves(); // Stubbing private method
        // Use a spy instead of a stub for setReplController
        setReplControllerSpy = sinon.spy(NativeRepl.prototype, 'setReplController');
    });

    teardown(() => {
        disposableArray.forEach((d) => {
            if (d) {
                d.dispose();
            }
        });

        disposableArray = [];
        sinon.restore();
    });

    test('getNativeRepl should call create constructor', async () => {
        const createMethodStub = sinon.stub(NativeRepl, 'create');
        interpreterService
            .setup((i) => i.getActiveInterpreter(TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(({ path: 'ps' } as unknown) as PythonEnvironment));
        const interpreter = await interpreterService.object.getActiveInterpreter();
        await getNativeRepl(interpreter as PythonEnvironment, disposableArray);

        expect(createMethodStub.calledOnce).to.be.true;
    });

    test('create should call setReplDirectory, setReplController', async () => {
        const interpreter = await interpreterService.object.getActiveInterpreter();
        interpreterService
            .setup((i) => i.getActiveInterpreter(TypeMoq.It.isAny()))
            .returns(() => Promise.resolve(({ path: 'ps' } as unknown) as PythonEnvironment));

        await NativeRepl.create(interpreter as PythonEnvironment);

        expect(setReplDirectoryStub.calledOnce).to.be.true;
        expect(setReplControllerSpy.calledOnce).to.be.true;

        setReplDirectoryStub.restore();
        setReplControllerSpy.restore();
    });
});
