#!/usr/bin/env python
# -*- coding:utf-8 -*-

# The SpeedTest package will give you information about your network speed
# Author: Florian Bouché
# Date: 2019-03-09
# Based on the package https://github.com/sivel/speedtest-cli

import utils
import os
import sys
import subprocess
import re

def speedtest(string, entities):
    """The SpeedTest package will give you information about your network speed """

    utils.output('inter', 'testing', utils.translate('testing'))

    realpath = os.path.dirname(os.path.realpath(__file__))
    process = subprocess.Popen(
    [sys.executable, realpath + '/speedtest.lib.py', '--simple'],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT
    )

    (output, err) = process.communicate()
    p_status = process.wait()

    if err:
        return utils.output('end', 'error', utils.translate('error'))

    rawoutput = output.decode('utf-8')

    data = {
        'ping': re.search('Ping:(.+?)\n', rawoutput).group(1).strip(),
        'download': re.search('Download:(.+?)\n', rawoutput).group(1).strip(),
        'upload': re.search('Upload:(.+?)\n', rawoutput).group(1).strip()
    }

    return utils.output('end', 'done', utils.translate('done', data))
