# Copilot Instructions for <script_name>

-   The script `<script_name>` is a Python python project within the workspace.
-   It has inline script metadata (as proposed by PEP 723) that defines the script name, required python version, and dependencies.
-   If imports which require a specific Python version or dependencies are added, keep the inline script metadata up to date.
-   You need to call the `Get Python Environment Information` tool on the `<script_name>` path to get the Python executable details.
-   Substitute the Python executable you get from the `Get Python Environment Information` tool anywhere you see `<python>` in these instructions.
    -   Run command for `<script_name>`: `<python> <script_name>`
    -   Script can be easily debugged from the Integrated Terminal when activated with the command `debugpy <script_name>` after the necessary environment is activated.
