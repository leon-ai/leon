#!/usr/bin/env python
# -*- coding:utf-8 -*-

# Give you information about your network speed
# Author: Florian Bouché
# Date: 2019-03-09
# Based on the package https://github.com/sivel/speedtest-cli

import utils
import os
import sys
import subprocess
import re


def run(params):
    """Give you information about your network speed"""

    utils.output('inter', 'testing')

    realpath = os.path.dirname(os.path.realpath(__file__))
    process = subprocess.Popen(
        [sys.executable, realpath + '/../lib/speed_test.lib.py', '--simple'],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT
    )

    (output, err) = process.communicate()
    p_status = process.wait()

    if err:
        return utils.output('end', 'error')

    rawoutput = output.decode('utf-8')

    data = {
        'ping': re.search('Ping:(.+?)\n', rawoutput).group(1).strip(),
        'download': re.search('Download:(.+?)\n', rawoutput).group(1).strip(),
        'upload': re.search('Upload:(.+?)\n', rawoutput).group(1).strip()
    }

    return utils.output('end', {'key': 'done', 'data': data})
