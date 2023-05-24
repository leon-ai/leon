import socket
import json

import lib.nlp as nlp


class TCPServer:
    def __init__(self, host, port):
        self.host = host
        self.port = port
        self.tcp_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.conn = None
        self.addr = None

    def init(self):
        # Make sure to establish TCP connection by reusing the address so it does not conflict with port already in use
        self.tcp_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.tcp_socket.bind((self.host, int(self.port)))
        self.tcp_socket.listen()

        while True:
            # Flush buffered output to make it IPC friendly (readable on stdout)
            print('Waiting for connection...', flush=True)

            # Our TCP server only needs to support one connection
            self.conn, self.addr = self.tcp_socket.accept()

            try:
                print(f'Client connected: {self.addr}')

                while True:
                    socket_data = self.conn.recv(1024)

                    if not socket_data:
                        break

                    data_dict = json.loads(socket_data)

                    # Verify the received topic can execute the method
                    method = data_dict['topic'].lower().replace('-', '_')
                    if hasattr(self.__class__, method) and callable(getattr(self.__class__, method)):
                        data = data_dict['data']
                        method = getattr(self, method)
                        res = method(data)

                        self.conn.sendall(json.dumps(res).encode('utf-8'))
            finally:
                print(f'Client disconnected: {self.addr}')
                self.conn.close()

    def get_spacy_entities(self, utterance):
        entities = nlp.extract_spacy_entities(utterance)

        return {
            'topic': 'spacy-entities-received',
            'data': {
                'spacyEntities': entities
            }
        }
