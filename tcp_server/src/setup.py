from cx_Freeze import setup, Executable
import sysconfig

options = {
    'build_exe': {
    	'packages': [
    		'spacy',
    		'torch',
    		'en_core_web_trf',
    		'fr_core_news_md'
    	],
        'includes': [
        	'srsly.msgpack.util',
        	'blis',
        	'cymem'
        ]
	}
}

# Include private libraries from the tokenizers package for Linux
if 'linux' in sysconfig.get_platform():
	options['build_exe']['include_files'] = [('tcp_server/src/.venv/lib/python3.9/site-packages/tokenizers.libs', 'lib/tokenizers.libs')]

executables = [
	Executable(
		script='tcp_server/src/main.py',
		target_name='leon-tcp-server'
    )
]

setup(
    name='leon-tcp-server',
    executables=executables,
    options=options
)
