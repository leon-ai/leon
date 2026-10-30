const listener = {}

listener.listening = (
  stream,
  minDecibels,
  maxBlankTime,
  cbOnStart,
  cbOnEnd
) => {
  const ctx = new AudioContext()
  const analyser = ctx.createAnalyser()
  const streamNode = ctx.createMediaStreamSource(stream)
  streamNode.connect(analyser)
  analyser.minDecibels = minDecibels

  const data = new Uint8Array(analyser.frequencyBinCount)
  let silenceStart = performance.now()
  let triggered = false

  const loop = (time) => {
    requestAnimationFrame(loop)

    analyser.getByteFrequencyData(data)

    if (data.some((v) => v)) {
      if (triggered) {
        triggered = false

        cbOnStart()
      }
      silenceStart = time
    }

    if (!triggered && time - silenceStart > maxBlankTime) {
      cbOnEnd()

      triggered = true
    }
  }

  loop()
}

export default listener
