from typing import ClassVar


class TraceLabelError(Exception):
    exit_code: ClassVar[int] = 1


class UserError(TraceLabelError):
    exit_code = 1


class EnvError(TraceLabelError):
    exit_code = 2
