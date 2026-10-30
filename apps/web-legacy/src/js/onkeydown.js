let index = -1
let parsedHistory = null

const onkeydowninput = (e, client) => {
  const key = e.which || e.keyCode

  if (localStorage.getItem('history') !== null && (key === 38 || key === 40)) {
    parsedHistory = JSON.parse(localStorage.getItem('history')).reverse()
  }

  if (key === 13 && !e.shiftKey) {
    if (client.send('utterance')) {
      parsedHistory = JSON.parse(localStorage.getItem('history')).reverse()
      index = -1
    }
  } else if (localStorage.getItem('history') !== null) {
    if (e.shiftKey) {
      if (key === 38 && index < parsedHistory.length - 1) {
        index += 1
        client.input = parsedHistory[index]
      } else if (key === 40 && index - 1 >= 0) {
        index -= 1
        client.input = parsedHistory[index]
      } else if (key === 40 && index - 1 < 0) {
        client.input = ''
        index = -1
      }
    }
  }
}

const onkeydownstartrecording = (e, cb) => {
  if ((e.metaKey || e.altKey) && e.key === 'c') {
    cb()
  }
}

export { onkeydowninput, onkeydownstartrecording }
