# Spotify Package

The Spotify package contains modules which lets Leon interface with Spotify.

## Modules

### Spotify

Use Leon to start|stop|search tracks|albums|artists on Spotify.

#### Usage

This package requires a Spotify Premium (:moneybag:) account. Once you have [signed up](https://www.spotify.com) please
follow these steps in order to start using Spotify via Leon
1. Login to [Spotify web api for developers](https://developer.spotify.com/dashboard/login)
2. Create a new client id (suitable app name: "Leon")
3. Make sure you have 
  - a client id
  - a client secret
4. Paste these into the package config file (packages/spotify/config/config.json)
5. Add the `redirect_uri` you find in (packages/spotify/config/config.sample.json)to redirect URIs at the Spotify Web
 API Dashboard (-> edit settings) 

```
(en-US) "Play track Smells like teen spirit"
        "Play album the white album by The Beatles"
        "Play artist Led Zeppelin"
        "Pause"
        "Resume"
        "Spotify Login"
        "Show artist Cardi B",
        "Show playlist Discover Weekly",
        "Display album Rubber Soul",
        "Display track War Pigs by Black Sabbath",

(fr-FR) ""
...
```
