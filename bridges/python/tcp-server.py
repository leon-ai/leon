import socket
import select
import os
import json
from os.path import join, dirname
from dotenv import load_dotenv
import spacy

dotenv_path = join(dirname(__file__), '../../.env')
load_dotenv(dotenv_path)

nlp = spacy.load('en_core_web_trf', disable=['tagger', 'parser', 'attribute_ruler', 'lemmatizer'])

ws_server_host = os.environ.get('LEON_PY_WS_SERVER_HOST', '0.0.0.0')
ws_server_port = os.environ.get('LEON_PY_WS_SERVER_PORT', 1342)

tcp_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
# Make sure to establish TCP connection by reusing the address so it does not conflict with port already in use
tcp_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
tcp_socket.bind((ws_server_host, int(ws_server_port)))
tcp_socket.listen()

def extract_spacy_entities(utterance):
	doc = nlp(utterance)
	entities = []

	for ent in doc.ents:
		entities.append({
			'start': ent.start_char,
			'end': ent.end_char,
			'len': len(ent.text),
			'sourceText': ent.text,
			'utteranceText': ent.text,
			'entity': ent.label_,
			'resolution': {
				'value': ent.text
			}
		})

	return entities

while True:
	print('Waiting for connection...')

	conn, addr = tcp_socket.accept()

	try:
		print(f'Client connected: {addr}')

		while True:
			data = conn.recv(1024)

			if not data:
				break

			data_dict = json.loads(data)

			if data_dict['topic'] == 'get-spacy-entities':
				utterance = data_dict['data']
				entities = extract_spacy_entities(utterance)
				res = {
					'topic': 'spacy-entities-received',
					'data': {
						'utterance': utterance,
						'spacyEntities': entities
					}
				}

				conn.sendall(json.dumps(res).encode('utf-8'))
	finally:
		print(f'Client disconnected: {addr}')
		conn.close()
