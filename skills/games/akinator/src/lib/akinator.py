"""
MIT License

Copyright (c) 2019 NinjaSnail1080

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
"""

from .utils import get_lang_and_theme, ans_to_id, raise_connection_error
from .exceptions import CantGoBackAnyFurther
import re
import time
import json
try:
    import requests
except ImportError:
    pass

#* URLs for the API requests
NEW_SESSION_URL = "https://{}/new_session?callback=jQuery331023608747682107778_{}&urlApiWs={}&partner=1&childMod={}&player=website-desktop&uid_ext_session={}&frontaddr={}&constraint=ETAT<>'AV'&soft_constraint={}&question_filter={}"
ANSWER_URL = "https://{}/answer_api?callback=jQuery331023608747682107778_{}&urlApiWs={}&childMod={}&session={}&signature={}&step={}&answer={}&frontaddr={}&question_filter={}"
BACK_URL = "{}/cancel_answer?callback=jQuery331023608747682107778_{}&childMod={}&session={}&signature={}&step={}&answer=-1&question_filter={}"
WIN_URL = "{}/list?callback=jQuery331023608747682107778_{}&childMod={}&session={}&signature={}&step={}"

#* HTTP headers to use for the requests
HEADERS = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
    "Accept-Encoding": "gzip, deflate",
    "Accept-Language": "en-US,en;q=0.9",
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) snap Chromium/81.0.4044.92 Chrome/81.0.4044.92 Safari/537.36",
    "x-requested-with": "XMLHttpRequest",
}


class Akinator():
    """A class that represents an Akinator game.

    The first thing you want to do after calling an instance of this class is to call "start_game()".
    """
    def __init__(self):
        self.uri = None
        self.server = None
        self.session = None
        self.signature = None
        self.uid = None
        self.frontaddr = None
        self.child_mode = None
        self.question_filter = None
        self.timestamp = None

        self.question = None
        self.progression = None
        self.step = None

        self.first_guess = None
        self.guesses = None

    def _update(self, resp, start=False):
        """Update class variables"""

        if start:
            self.session = int(resp["parameters"]["identification"]["session"])
            self.signature = int(resp["parameters"]["identification"]["signature"])
            self.question = str(resp["parameters"]["step_information"]["question"])
            self.progression = float(resp["parameters"]["step_information"]["progression"])
            self.step = int(resp["parameters"]["step_information"]["step"])
        else:
            self.question = str(resp["parameters"]["question"])
            self.progression = float(resp["parameters"]["progression"])
            self.step = int(resp["parameters"]["step"])

    def _parse_response(self, response):
        """Parse the JSON response and turn it into a Python object"""

        return json.loads(",".join(response.split("(")[1::])[:-1])

    def _get_session_info(self):
        """Get uid and frontaddr from akinator.com/game"""

        info_regex = re.compile("var uid_ext_session = '(.*)'\\;\\n.*var frontaddr = '(.*)'\\;")
        r = requests.get("https://en.akinator.com/game")

        match = info_regex.search(r.text)
        self.uid, self.frontaddr = match.groups()[0], match.groups()[1]

    def _auto_get_region(self, lang, theme):
        """Automatically get the uri and server from akinator.com for the specified language and theme"""

        server_regex = re.compile("[{\"translated_theme_name\":\"[\s\S]*\",\"urlWs\":\"https:\\\/\\\/srv[0-9]+\.akinator\.com:[0-9]+\\\/ws\",\"subject_id\":\"[0-9]+\"}]")
        uri = lang + ".akinator.com"

        bad_list = ["https://srv12.akinator.com:9398/ws"]
        while True:
            r = requests.get("https://" + uri)

            match = server_regex.search(r.text)
            parsed = json.loads(match.group().split("'arrUrlThemesToPlay', ")[-1])

            if theme == "c":
                server = next((i for i in parsed if i["subject_id"] == "1"), None)["urlWs"]
            elif theme == "a":
                server = next((i for i in parsed if i["subject_id"] == "14"), None)["urlWs"]
            elif theme == "o":
                server = next((i for i in parsed if i["subject_id"] == "2"), None)["urlWs"]

            if server not in bad_list:
                return {"uri": uri, "server": server}

    def start_game(self, language=None, child_mode=False):
        """Start an Akinator game. Run this function first before the others. Returns a string containing the first question

        The "language" parameter can be left as None for English, the default language, or it can be set to one of the following (case-insensitive):
            - "en": English (default)
            - "en_animals": English server for guessing animals
            - "en_objects": English server for guessing objects
            - "ar": Arabic
            - "cn": Chinese
            - "de": German
            - "de_animals": German server for guessing animals
            - "es": Spanish
            - "es_animals": Spanish server for guessing animals
            - "fr": French
            - "fr_animals": French server for guessing animals
            - "fr_objects": French server for guessing objects
            - "il": Hebrew
            - "it": Italian
            - "it_animals": Italian server for guessing animals
            - "jp": Japanese
            - "jp_animals": Japanese server for guessing animals
            - "kr": Korean
            - "nl": Dutch
            - "pl": Polish
            - "pt": Portuguese
            - "ru": Russian
            - "tr": Turkish
            - "id": Indonesian
        You can also put the name of the language spelled out, like "spanish", "korean", "french_animals", etc.

        The "child_mode" parameter is False by default. If it's set to True, then Akinator won't ask questions about things that are NSFW
        """
        self.timestamp = time.time()
        region_info = self._auto_get_region(get_lang_and_theme(language)["lang"], get_lang_and_theme(language)["theme"])
        self.uri, self.server = region_info["uri"], region_info["server"]

        self.child_mode = child_mode
        soft_constraint = "ETAT%3D%27EN%27" if self.child_mode else ""
        self.question_filter = "cat%3D1" if self.child_mode else ""

        self._get_session_info()

        r = requests.get(NEW_SESSION_URL.format(self.uri, self.timestamp, self.server, str(self.child_mode).lower(), self.uid, self.frontaddr, soft_constraint, self.question_filter), headers=HEADERS)
        # TODO: save r.text
        # print('r.text', r.text)
        resp = self._parse_response(r.text)

        if resp["completion"] == "OK":
            self._update(resp, True)
            return self.question
        else:
            return raise_connection_error(resp["completion"])

    def answer(self, ans):
        """Answer the current question, which you can find with "Akinator.question". Returns a string containing the next question

        The "ans" parameter must be one of these (case-insensitive):
            - "yes" OR "y" OR "0" for YES
            - "no" OR "n" OR "1" for NO
            - "i" OR "idk" OR "i dont know" OR "i don't know" OR "2" for I DON'T KNOW
            - "probably" OR "p" OR "3" for PROBABLY
            - "probably not" OR "pn" OR "4" for PROBABLY NOT
        """
        ans = ans_to_id(ans)

        r = requests.get(ANSWER_URL.format(self.uri, self.timestamp, self.server, str(self.child_mode).lower(), self.session, self.signature, self.step, ans, self.frontaddr, self.question_filter), headers=HEADERS)
        resp = self._parse_response(r.text)

        if resp["completion"] == "OK":
            self._update(resp)
            return self.question
        else:
            return raise_connection_error(resp["completion"])

    def back(self):
        """Goes back to the previous question. Returns a string containing that question

        If you're on the first question and you try to go back again, the CantGoBackAnyFurther exception will be raised
        """
        if self.step == 0:
            raise CantGoBackAnyFurther("You were on the first question and couldn't go back any further")

        r = requests.get(BACK_URL.format(self.server, self.timestamp, str(self.child_mode).lower(), self.session, self.signature, self.step, self.question_filter), headers=HEADERS)
        resp = self._parse_response(r.text)

        if resp["completion"] == "OK":
            self._update(resp)
            return self.question
        else:
            return utils.raise_connection_error(resp["completion"])

    def win(self):
        """Get Aki's guesses for who the person you're thinking of is based on your answers to the questions so far

        Defines and returns the variable "Akinator.first_guess", a dictionary describing his first choice for who you're thinking about. The three most important values in the dict are "name" (character's name), "description" (description of character), and "absolute_picture_path" (direct link to image of character)

        This function also defines "Akinator.guesses", which is a list of dictionaries containing his choices in order from most likely to least likely

        It's recommended that you call this function when Aki's progression is above 85%, which is when he will have most likely narrowed it down to just one choice. You can get his current progression via "Akinator.progression"
        """
        r = requests.get(WIN_URL.format(self.server, self.timestamp, str(self.child_mode).lower(), self.session, self.signature, self.step), headers=HEADERS)
        resp = self._parse_response(r.text)

        if resp["completion"] == "OK":
            self.first_guess = resp["parameters"]["elements"][0]["element"]
            self.guesses = [g["element"] for g in resp["parameters"]["elements"]]
            return self.first_guess
        else:
            return utils.raise_connection_error(resp["completion"])
