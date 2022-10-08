from cx_Freeze import setup, Executable

from version import __version__

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
    version=__version__,
    executables=executables,
    options=options
)
