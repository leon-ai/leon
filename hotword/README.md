# Hotword

This node enables the wake word "Leon". Once this is running, you can
call Leon by saying his name according to the language you chose.
## Getting Started

Please use **Node.js 8.x** here.

Tips: use [nvm](https://github.com/creationix/nvm) to easily manage your Node.js versions.

### Installation

```sh
# Install
npm run setup:offline-hotword
```

### Usage

```sh
# From the project root:

# Run main server
npm run build && npm start

# Go to http://localhost:1337

# Run hotword node
npm run wake

# Say "Leon" via your microphone
# Triggered!
```
