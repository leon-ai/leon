from cx_Freeze import setup, Executable

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
