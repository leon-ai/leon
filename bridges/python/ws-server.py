import socketio
import eventlet
import os
from os.path import join, dirname
from dotenv import load_dotenv
import spacy

dotenv_path = join(dirname(__file__), '../../.env')
load_dotenv(dotenv_path)

nlp = spacy.load('en_core_web_trf', disable=['tagger', 'parser', 'attribute_ruler', 'lemmatizer'])

sio = socketio.Server(async_mode='eventlet', cors_allowed_origins="*", logger=False, engineio_logger=False)
# sio = socketio.Server(async_mode='eventlet', cors_allowed_origins="*")
app = socketio.WSGIApp(sio)

ws_server_host = os.environ.get('LEON_PY_WS_SERVER_HOST', '0.0.0.0')
ws_server_port = os.environ.get('LEON_PY_WS_SERVER_PORT', 1342)

@sio.event
def connect(sid, env, auth):
    print('Client connected ', sid)

@sio.event
def disconnect(sid):
    print('Client disconnected', sid)

@sio.event
def extract_entities(sid, utterance):
	print('DO YOUR JOOOB')
	doc = nlp(utterance)

	for ent in doc.ents:
		print(ent.text, ent.label_)

	sio.emit('entities_extracted', {'data': 'foobar'}, room=sid)

try:
	print('Python WebSocket server is running on ' + ws_server_host + ':' + ws_server_port)
	eventlet.wsgi.server(eventlet.listen((ws_server_host, int(ws_server_port))), app)
except:
	print('Python WebSocket server failed to run. Please check that the ' + ws_server_port + ' port is free on ' + ws_server_host)
