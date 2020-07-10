const os = require('os')
const path = require('path')
const fs = require('fs')
const log = require('./log')
const puppeteer = require('puppeteer-extra')
const StealthPlugin = require('puppeteer-extra-plugin-stealth')
const { deleteFolderRecursive, sleep } = require('./utils')

// setting "user-agent-override" evasion is not working for us because it can't be changed
// in each request. we set the user-agent in the browser args instead
puppeteer.use(StealthPlugin())

const sessions = {}

function userDataDirFromId (id) {
  return path.join(os.tmpdir(), `/puppeteer_firefox_profile_${id}`)
}

function prepareBrowserProfile (userAgent, id) {
  const userDataDir = userDataDirFromId(id)

  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true })
  }

  const prefs = `user_pref("general.useragent.override", "${userAgent}");`
  fs.writeFile(path.join(userDataDir, 'prefs.js'), prefs, () => { })
  return userDataDir
}

module.exports = {
  create: async (id, { userAgent }) => {
    const puppeteerOptions = {
      product: 'firefox',
      headless: true
    }

    if (userAgent) {
      log.debug(`Using custom User-Agent: ${userAgent}`)
      puppeteerOptions.userDataDir = prepareBrowserProfile(userAgent, id)
    }

    log.debug('Launching headless browser...')

    // TODO: try and launch the browser at least 3 times before sending back
    // "Error: Failed to launch the browser process!"
    const browser = await puppeteer.launch(puppeteerOptions)
    sessions[id] = browser

    return browser
  },
  list: () => Object.keys(sessions),
  destroy: async (id) => {
    const browser = sessions[id]
    if (browser) {
      await browser.close()
      delete sessions[id]
      const userDataDirPath = userDataDirFromId(id)
      try {
        await sleep(5000)
        deleteFolderRecursive(userDataDirPath)
      } catch (e) {
        console.log(e)
        throw Error(`Error deleting browser session folder. ${e.message}`)
      }
      return true
    }
    return false
  },
  get: id => sessions[id] || false
}
