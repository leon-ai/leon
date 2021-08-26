
import cv2
import os
import smtplib
import datetime
name=input("Name: ")
camera = cv2.VideoCapture(0)
return_value, image = camera.read()
date_string = datetime.datetime.now().strftime("%d%m%Y%H%M%S")
cv2.imwrite(os.path.join('/' , name+'.jpg'), image)
print(os.path.join('/' , name+'.jpg'))
