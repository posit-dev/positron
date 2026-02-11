# Copilot Instructions for <package_name>

-   The package `<package_name>` is a Python Project located in the folder `<package_name>-folder`.
-   You need to call the `Get Python Environment Information` tool on the `<package_name>` path to get the Python executable details.
-   Substitute the Python executable you get from the `Get Python Environment Information` tool anywhere you see `<python>` in these instructions.
    -   Run command for `<package_name>`: `<python> -m <package_name>`
    -   Command to run tests for `<package_name>`: `<python> -m pytest <package_name>/tests`
-   To run an editable install for the package `<package_name>`, use the `Install Python Package` tool with the `<package_name>-folder` path and arguments `['-e', '.']`.
-   In the workspace `launch.json` file, configurations related to this package have the prefix `<package_name>`.
-   The package `<package_name>` has a defined `pyproject.toml` file that you should use and keep up to date.
