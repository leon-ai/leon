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

from .exceptions import InvalidAnswerError, InvalidLanguageError, AkiServerDown, AkiTechnicalError, AkiTimedOut, AkiNoQuestions, AkiConnectionFailure

def ans_to_id(ans):
    """Convert an input answer string into an Answer ID for Akinator"""

    ans = str(ans).lower()
    if ans == "yes" or ans == "y" or ans == "0":
        return "0"
    elif ans == "no" or ans == "n" or ans == "1":
        return "1"
    elif ans == "i" or ans == "idk" or ans == "i dont know" or ans == "i don't know" or ans == "2":
        return "2"
    elif ans == "probably" or ans == "p" or ans == "3":
        return "3"
    elif ans == "probably not" or ans == "pn" or ans == "4":
        return "4"
    else:
        raise InvalidAnswerError("""
        You put "{}", which is an invalid answer.
        The answer must be one of these:
            - "yes" OR "y" OR "0" for YES
            - "no" OR "n" OR "1" for NO
            - "i" OR "idk" OR "i dont know" OR "i don't know" OR "2" for I DON'T KNOW
            - "probably" OR "p" OR "3" for PROBABLY
            - "probably not" OR "pn" OR "4" for PROBABLY NOT
        """.format(ans))


def get_lang_and_theme(lang=None):
    """Returns the language code and theme based on what is input"""

    if lang is None:
        return {"lang": "en", "theme": "c"}

    lang = str(lang).lower()
    if lang == "en" or lang == "english":
        return {"lang": "en", "theme": "c"}
    elif lang == "en_animals" or lang == "english_animals":
        return {"lang": "en", "theme": "a"}
    elif lang == "en_objects" or lang == "english_objects":
        return {"lang": "en", "theme": "o"}
    elif lang == "ar" or lang == "arabic":
        return {"lang": "ar", "theme": "c"}
    elif lang == "cn" or lang == "chinese":
        return {"lang": "cn", "theme": "c"}
    elif lang == "de" or lang == "german":
        return {"lang": "de", "theme": "c"}
    elif lang == "de_animals" or lang == "german_animals":
        return {"lang": "de", "theme": "a"}
    elif lang == "es" or lang == "spanish":
        return {"lang": "es", "theme": "c"}
    elif lang == "es_animals" or lang == "spanish_animals":
        return {"lang": "es", "theme": "a"}
    elif lang == "fr" or lang == "french":
        return {"lang": "fr", "theme": "c"}
    elif lang == "fr_animals" or lang == "french_animals":
        return {"lang": "fr", "theme": "a"}
    elif lang == "fr_objects" or lang == "french_objects":
        return {"lang": "fr", "theme": "o"}
    elif lang == "il" or lang == "hebrew":
        return {"lang": "il", "theme": "c"}
    elif lang == "it" or lang == "italian":
        return {"lang": "it", "theme": "c"}
    elif lang == "it_animals" or lang == "italian_animals":
        return {"lang": "it", "theme": "a"}
    elif lang == "jp" or lang == "japanese":
        return {"lang": "jp", "theme": "c"}
    elif lang == "jp_animals" or lang == "japanese_animals":
        return {"lang": "jp", "theme": "a"}
    elif lang == "kr" or lang == "korean":
        return {"lang": "kr", "theme": "c"}
    elif lang == "nl" or lang == "dutch":
        return {"lang": "nl", "theme": "c"}
    elif lang == "pl" or lang == "polish":
        return {"lang": "pl", "theme": "c"}
    elif lang == "pt" or lang == "portuguese":
        return {"lang": "pt", "theme": "c"}
    elif lang == "ru" or lang == "russian":
        return {"lang": "ru", "theme": "c"}
    elif lang == "tr" or lang == "turkish":
        return {"lang": "tr", "theme": "c"}
    elif lang == "id" or lang == "indonesian":
        return {"lang": "id", "theme": "c"}
    else:
        raise InvalidLanguageError("You put \"{}\", which is an invalid language.".format(lang))


def raise_connection_error(response):
    """Raise the proper error if the API failed to connect"""

    if response == "KO - SERVER DOWN":
        raise AkiServerDown("Akinator's servers are down in this region. Try again later or use a different language")
    elif response == "KO - TECHNICAL ERROR":
        raise AkiTechnicalError("Akinator's servers have had a technical error. Try again later or use a different language")
    elif response == "KO - TIMEOUT":
        raise AkiTimedOut("Your Akinator session has timed out")
    elif response == "KO - ELEM LIST IS EMPTY" or response == "WARN - NO QUESTION":
        raise AkiNoQuestions("\"Akinator.step\" reached 79. No more questions")
    else:
        raise AkiConnectionFailure("An unknown error has occured. Server response: {}".format(response))
