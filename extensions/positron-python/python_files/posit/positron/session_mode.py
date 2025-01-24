#
# Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
# Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
#

import enum

import traitlets


class SessionMode(str, enum.Enum):
    """
    The mode that the kernel application was started in.
    """

    CONSOLE = "console"
    NOTEBOOK = "notebook"
    BACKGROUND = "background"

    DEFAULT = CONSOLE

    def __str__(self) -> str:
        # Override for better display in argparse help.
        return self.value

    @classmethod
    def trait(cls) -> traitlets.Enum:
        return traitlets.Enum(sorted(cls), help=cls.__doc__)
