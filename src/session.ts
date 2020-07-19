import * as os from 'os'
import * as path from 'path'
import * as fs from 'fs'

import puppeteer from 'puppeteer-extra'
import { LaunchOptions, Browser, Headers, SetCookie } from 'puppeteer'

import log from './log'
import { deleteFolderRecursive, sleep, removeEmptyFields } from './utils'

interface SessionPageDefaults {
  headers?: Headers
  userAgent?: string
}

export interface SessionsCacheItem {
  browser: Browser
  userDataDir?: string
  defaults: SessionPageDefaults
}

interface SessionsCache {
  [key: string]: SessionsCacheItem
}

interface SessionCreateOptions {
  oneTimeSession?: boolean
  userAgent?: string
  cookies?: SetCookie[]
  headers?: Headers,
  maxTimeout?: number
}

const sessionCache: SessionsCache = {}
const USER_DATA_DIR_PARENT = process.env.USER_DATA_DIR_PARENT || os.tmpdir()

function userDataDirFromId(id: string): string {
  return path.join(USER_DATA_DIR_PARENT, `cp_profile_${id}`)
}

function prepareBrowserProfile(id: string): string {
  // TODO: maybe pass SessionCreateOptions for loading later?
  const userDataDir = userDataDirFromId(id)

  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true })
  }

  return userDataDir
}

puppeteer.use(require('puppeteer-extra-plugin-stealth')())

const methods = {
  create: async (id: string, { cookies, oneTimeSession, userAgent, headers, maxTimeout }: SessionCreateOptions): Promise<SessionsCacheItem> => {
    const puppeteerOptions: LaunchOptions = {
      product: 'chrome',
      headless: true
    }

    if (!oneTimeSession) {
      log.debug('Creating userDataDir for session.')
      puppeteerOptions.userDataDir = prepareBrowserProfile(id)
    }

    log.debug('Launching headless browser...')

    // TODO: maybe access env variable?
    // TODO: sometimes browser instances are created and not connected to correctly.
    //       how do we handle/quit those instances inside Docker?
    let launchTries = 3
    let browser;

    while (0 <= launchTries--) {
      try {
        browser = await puppeteer.launch(puppeteerOptions)
        break
      } catch (e) {
        if (e.message !== 'Failed to launch the browser process!')
          throw e
        log.warn('Failed to open browser, trying again...')
      }
    }

    if (!browser) { throw Error(`Failed to lanch browser 3 times in a row.`) }

    if (cookies) {
      const page = await browser.newPage()
      await page.setCookie(...cookies)
    }

    sessionCache[id] = {
      browser,
      userDataDir: puppeteerOptions.userDataDir,
      defaults: removeEmptyFields({
        userAgent,
        headers,
        maxTimeout
      })
    }

    return sessionCache[id]
  },

  list: (): string[] => Object.keys(sessionCache),

  close: (id: string): boolean => {
    // prevents bloating in the temp directory
    if (!process.env.USER_DATA_DIR_PARENT) {
      throw Error('Can only close sessions when using USER_DATA_DIR_PARENT=...')
    }

    const { browser } = sessionCache[id]
    if (browser) {
      browser.close()
      return true
    }
    return false
  },
  destroy: async (id: string): Promise<boolean> => {
    const { browser, userDataDir } = sessionCache[id]
    if (browser) {
      await browser.close()
      delete sessionCache[id]
      if (userDataDir) {
        const userDataDirPath = userDataDirFromId(id)
        try {
          // for some reason this keeps an error from being thrown in Windows, figures
          await sleep(5000)
          deleteFolderRecursive(userDataDirPath)
        } catch (e) {
          console.log(e)
          throw Error(`Error deleting browser session folder. ${e.message}`)
        }
      }
      return true
    }
    return false
  },

  get: (id: string): SessionsCacheItem | false => sessionCache[id] && sessionCache[id] || false
}

export default methods