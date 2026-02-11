export function isTestExecution(): boolean {
    return !!process.env.VSC_PYTHON_CI_TEST;
}
