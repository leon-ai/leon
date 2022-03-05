import socket
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
tcp_socket.bind((ws_server_host, int(ws_server_port)))
tcp_socket.listen()

def extract_spacy_entities(utterance):
	doc = nlp(utterance)

	for ent in doc.ents:
		print(ent.text, ent.label_)

while True:
	print('Waiting for connection...')
	connection, addr = tcp_socket.accept()

	try:
		print(f'Client connected: {addr}')

		while True:
			data = connection.recv(1024)
			data_dict = json.loads(data)

			print('data', data)

			if data_dict['topic'] == 'get-spacy-entities':
				extract_spacy_entities(data_dict['data'])

			print(f'Received data: {data_dict}')

			if not data:
				break

			connection.sendall(data)

	finally:
		connection.close()
