Launch tests by running this from the repository root:

    npm run test-extension -- -l positron-data-driver-odbc

These tests use fixtures throughout: discovery runs against an injected `IOdbcConfigHost`, and the
driver is built from a synthetic `OdbcConfiguration`. Nothing here needs unixODBC installed or a
database to connect to.
