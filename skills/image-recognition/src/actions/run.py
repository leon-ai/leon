from bridges.python.src.sdk.leon import leon
from bridges.python.src.sdk.types import ActionParams
from bridges.python.src.sdk.network import Network
import evadb
import wget
from pathlib import Path
import cv2
from ipywidgets import Image
import requests
from matplotlib import pyplot as plt

def run(params: ActionParams) -> None:
    cursor = evadb.connect().cursor()

    domains: list[str] = []

    # Find entities from the current utterance
    for item in params['current_entities']:
        if item['entity'] == 'url':
            domains.append(item['resolution']['value'].lower())

    if len(domains) == 0:
        # Find entities from the context
        for item in params['entities']:
            if item['entity'] == 'url':
                domains.append(item['resolution']['value'].lower())
                
    detect_objects('https://cdn.pixabay.com/photo/2017/01/14/10/56/people-1979261_1280.jpg')

def download_image(url, name):
  path = Path(url)
  file_extension = path.suffix

  filename = name + file_extension
  response = requests.get(url)
  response.raise_for_status()  # Check for errors during the request

  with open(name+file_extension, 'wb') as file:
      file.write(response.content)


def annotate_image(detections, input_image_path, output_image_path):
    color1=(207, 248, 64)
    color2=(255, 49, 49)
    thickness=4
    image = cv2.imread(input_image_path) 
    output_image = image.copy()

    # Now, let's traverse over the DataFrame:
    for index, row in detections.iterrows():
        labels = row['yolo.labels']
        bboxes = row['yolo.bboxes']
        scores = row['yolo.scores']

        # vcap = cv2.VideoCapture(input_video_path)
        # result = Image.from_file(output_video_path)

        #     dfLst = df.values.tolist()
        nlabels = len(labels)
        for i in range(nlabels):
            x1, y1, x2, y2 = bboxes[i][0], bboxes[i][1], bboxes[i][2], bboxes[i][3]
            x1, y1, x2, y2 = int(x1), int(y1), int(x2), int(y2)
            output_image = cv2.rectangle(output_image, (x1, y1), (x2, y2), color1, thickness)
            cv2.putText(output_image, labels[i], (x1, y1-10), cv2.FONT_HERSHEY_SIMPLEX, 0.9, color1, thickness)
            cv2.imwrite(output_image_path, output_image)
            Image.from_file(output_image_path)
        
        plt.imshow(output_image)
        plt.show()


def detect_objects(image_url):
  image_name = 'image'
  download_image(image_url, image_name)
  path = Path(image_url)
  file_extension = path.suffix
  

  cursor.query("DROP TABLE IF EXISTS MyImage;").df()
  cursor.query("LOAD IMAGE '{image}' INTO MyImage;".format(image=image_name+file_extension)).df()
  cursor.query("""
    CREATE FUNCTION IF NOT EXISTS Yolo
    TYPE ultralytics
    MODEL 'yolov8m.pt';
""").df()

  yolo_query = cursor.query("""
      SELECT Yolo(data)
      FROM MyImage
  """)
  response = yolo_query.df()

  path = Path(image_url)
  file_extension = path.suffix
  annotate_image(response, image_name + file_extension, image_name + '_annotated' + file_extension)
  
