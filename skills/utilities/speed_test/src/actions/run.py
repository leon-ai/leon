# Give you information about your network speed
# Author: Florian Bouché
# Date: 2019-03-09
# Based on the package https://github.com/sivel/speedtest-cli

from bridges.python.src.sdk.leon import leon
from bridges.python.src.sdk.types import ActionParams
from ..lib import speedtest

import sys


def run(params: ActionParams) -> None:
    """Give you information about your network speed"""

    leon.answer({'key': 'testing'})

    try:
        speedtest_instance = speedtest.Speedtest()
        speedtest_instance.download()
        speedtest_instance.upload()
        speedtest_instance.results.share()

        results = speedtest_instance.results.dict()
        download = round(results['download'] / 1_000_000, 2)
        upload = round(results['upload'] / 1_000_000, 2)
        ping = round(results['ping'], 3)

        return leon.answer({
            'key': 'done',
            'data': {
                'ping': f'{ping} ms',
                'download': f'{download} Mbit/s',
                'upload': f'{upload} Mbit/s'
            }
        })
    except Exception as e:
        print(e, flush=True, file=sys.stderr)
        return leon.answer({'key': 'error'})
