import * as os from 'os'
import * as path from 'path'
import * as fs from 'fs'

import puppeteer from 'puppeteer-extra'
import { LaunchOptions, Browser } from 'puppeteer'

import log from './log'
import { deleteFolderRecursive, sleep } from './utils'

interface SessionsCache {
  [key: string]: Browser;
}

const sessionCache: SessionsCache = {}

// setting "user-agent-override" evasion is not working for us because it can't be changed
// in each request. we set the user-agent in the browser args instead
puppeteer.use(require('puppeteer-extra-plugin-stealth')())

function userDataDirFromId(id: string): string {
  return path.join(os.tmpdir(), `/puppeteer_chrome_profile_${id}`)
}

function prepareBrowserProfile(userAgent: string, id: string): string {
  const userDataDir = userDataDirFromId(id)

  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true })
  }

  return userDataDir
}

export const create = async (id: string, { userAgent }: { userAgent: string }): Promise<Browser> => {
  const puppeteerOptions: LaunchOptions = {
    product: 'chrome',
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
  sessionCache[id] = browser

  return browser
}

export const list = (): string[] => Object.keys(sessionCache)

export const destroy = async (id: string): Promise<boolean> => {
  const browser = sessionCache[id]
  if (browser) {
    await browser.close()
    delete sessionCache[id]
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
}

export const get = (id: string): Browser | false => sessionCache[id] || false

