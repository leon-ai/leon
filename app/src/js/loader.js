export default class Loader {
  constructor () {
    this.et = new EventTarget()
    this.body = document.querySelector('body')

    this.et.addEventListener('settingup', (event) => {
      if (event.detail) {
        this.body.classList.add('settingup')
      } else {
        this.body.classList.remove('settingup')
      }
    })
  }

  start () {
    this.et.dispatchEvent(new CustomEvent('settingup', { detail: true }))
  }

  stop () {
    this.et.dispatchEvent(new CustomEvent('settingup', { detail: false }))
  }
}
