import re
import stat
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from zipfile import BadZipFile, ZipFile

SVG = '{http://www.w3.org/2000/svg}'
CHARTS = ('star-history-light.svg', 'star-history-dark.svg')
MAX_SVG_BYTES = 512 * 1024
MAX_ARCHIVE_BYTES = 2 * MAX_SVG_BYTES
ATTRIBUTES = {
    'svg': {'aria-labelledby', 'class', 'height', 'role', 'viewBox', 'width'},
    'title': {'id'},
    'desc': {'id'},
    'style': set(),
    'defs': set(),
    'linearGradient': {'id', 'x1', 'x2', 'y1', 'y2'},
    'stop': {'class', 'offset', 'stop-opacity'},
    'g': {'class'},
    'text': {'aria-label', 'class', 'font-size', 'font-weight', 'text-anchor', 'x', 'y'},
    'tspan': {'class'},
    'line': {'class', 'opacity', 'stroke-width', 'x1', 'x2', 'y1', 'y2'},
    'path': {'class', 'd', 'data-chart', 'fill', 'stroke-linecap', 'stroke-linejoin', 'stroke-width'},
    'circle': {'class', 'cx', 'cy', 'fill', 'r'},
}
SAFE_FILL = {'transparent', 'url(#sc-neon-glow-stream-stream)'}


def parse_chart(raw, name):
    text = raw.decode('utf-8')
    if re.search(r'<[!?]', text):
        raise ValueError(f'{name}: XML declarations, directives and DTDs are not allowed')
    return ET.fromstring(text)


def validate_chart(raw, destination):
    name = destination.name
    incoming = parse_chart(raw, name)
    existing = parse_chart(destination.read_bytes(), name)
    if incoming.tag != f'{SVG}svg' or incoming.attrib != existing.attrib:
        raise ValueError(f'{name}: unexpected SVG dimensions or root attributes')

    for element in incoming.iter():
        if not element.tag.startswith(SVG):
            raise ValueError(f'{name}: elements outside the SVG namespace are not allowed')
        allowed = ATTRIBUTES.get(element.tag.removeprefix(SVG))
        if allowed is None or element.attrib.keys() - allowed:
            raise ValueError(f'{name}: unexpected SVG element or attribute')
        if 'fill' in element.attrib and element.get('fill') not in SAFE_FILL:
            raise ValueError(f'{name}: only the local chart gradient or transparent fill is allowed')

    # CSS is executable by the renderer. Only accept the checked-in theme CSS,
    # never a stylesheet or inline style supplied by the generation job.
    styles = incoming.findall(f'.//{SVG}style')
    if len(styles) != 1 or len(styles[0]) or styles[0].text != existing.findtext(f'{SVG}style'):
        raise ValueError(f'{name}: unexpected SVG stylesheet')

    layers = [element.get('data-chart') for element in incoming.iter(f'{SVG}path') if 'data-chart' in element.attrib]
    if layers != ['neon-glow-stream-fill', 'neon-glow-stream']:
        raise ValueError(f'{name}: expected the chart fill and line')


def install(source, destination):
    if not stat.S_ISDIR(source.lstat().st_mode):
        raise ValueError('Expected an artifact download directory')
    files = list(source.iterdir())
    if len(files) != 1:
        raise ValueError('Expected exactly one chart archive')
    info = files[0].lstat()
    if not stat.S_ISREG(info.st_mode) or not 0 < info.st_size <= MAX_ARCHIVE_BYTES:
        raise ValueError('Expected a regular, bounded chart archive')

    # Never extract the archive. Only read the two expected members into memory.
    images = {}
    with ZipFile(files[0]) as archive:
        if sorted(archive.namelist()) != sorted(CHARTS):
            raise ValueError('Expected exactly the light and dark SVGs in the chart artifact')
        for name in CHARTS:
            if not 0 < archive.getinfo(name).file_size <= MAX_SVG_BYTES:
                raise ValueError(f'{name}: expected a bounded SVG')
            with archive.open(name) as member:
                raw = member.read(MAX_SVG_BYTES + 1)
            if not 0 < len(raw) <= MAX_SVG_BYTES:
                raise ValueError(f'{name}: expected a bounded SVG')
            validate_chart(raw, destination / name)
            images[name] = raw

    # Finish validation before replacing either checked-in chart.
    for name, raw in images.items():
        (destination / name).write_bytes(raw)


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit('Usage: install-star-history.py <artifact-directory> <asset-directory>')
    try:
        install(Path(sys.argv[1]), Path(sys.argv[2]))
    except (OSError, ValueError, ET.ParseError, BadZipFile) as error:
        sys.exit(f'Invalid star history artifact: {error}')
