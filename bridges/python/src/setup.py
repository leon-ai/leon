import requests.certs
from cx_Freeze import setup, Executable

options = {
    'build_exe': {
    	# Add common dependencies for skills
        'includes': [
        	'bs4',
        	'pytube'
        ]
	}
}

executables = [
	Executable(
		script='bridges/python/src/main.py',
		target_name='leon-python-bridge'
    )
]

setup(
    name='leon-python-bridge',
    executables=executables,
    options=options
)
