import os
from pathlib import Path
from typing import Callable, Optional
from zipfile import ZIP_DEFLATED, ZipFile


def create_zip_archive(
    directory: str,
    destination: str,
    exclude: Optional[Callable[[str], bool]] = None,
) -> None:
    """ZIP regular files using relative POSIX paths, skipping links and the ZIP itself.

    Excluding a directory excludes all its descendants. The destination's parent
    must already exist, and the source must be a regular directory.
    """
    source = Path(os.path.abspath(directory))
    output = Path(os.path.abspath(destination))

    if source.is_symlink() or not source.is_dir():
        raise ValueError('ZIP source must be a regular directory.')

    def collect(current: Path, archive: ZipFile) -> None:
        for item in current.iterdir():
            relative = item.relative_to(source).as_posix()

            if item == output or item.is_symlink() or (exclude and exclude(relative)):
                continue

            if item.is_dir():
                collect(item, archive)
            elif item.is_file():
                archive.write(item, relative)

    with ZipFile(output, 'w', compression=ZIP_DEFLATED) as archive:
        collect(source, archive)
