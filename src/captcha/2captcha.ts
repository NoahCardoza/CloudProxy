import got from 'got'
import { sleep } from '../utils'
import {CaptchaType, SolverOptions} from "./index";
import log from "../log";

const tcRetryPause = 5000
const tcInitialPause = 15000
const tcUrlApiReq = 'https://2captcha.com/in.php'
const tcUrlApiResult = 'https://2captcha.com/res.php'


export default async function solve({ url, sitekey, type }: SolverOptions): Promise<string> {
  log.info('2Captcha: Starting to resolve URL: ' + url)
  if (type != 'hCaptcha')
    throw 'Unsupported captcha type: ' + type

  const apikey = process.env.TWOCAPTCHA_APIKEY

  const reqUrl = tcUrlApiReq + '?key=' + apikey + '&method=hcaptcha' + '&sitekey=' + sitekey + '&pageurl=' + url + '&json=1'
  log.info('2Captcha: Sending challenge: ' + reqUrl)
  const resp = await got(reqUrl)
  log.info('2Captcha: Response: ' + resp.body)

  const content = JSON.parse(resp.body)

  if (content.status != 1)
    throw Error('2Captcha returned error: ' + content.request)

  log.info('2Captcha: Initial pause: ' + tcInitialPause + ' ms')
  await sleep(tcInitialPause)

  const respUrl = tcUrlApiResult + '?key=' + apikey + '&id=' + content.request + '&json=1&action=get'
  while(true) {
    log.info('2Captcha: Querying solution URL: ' + respUrl)
    const result = await got(respUrl)
    log.info('2Captcha: Response: ' + result.body)

    const solution = JSON.parse(result.body)

    if (solution.status == 0) {
      return solution.request
    }
    else {
      if(solution.request === 'CAPCHA_NOT_READY') {
        log.info('2Captcha: Solution not ready yet. Retrying soon...')
        await sleep(tcRetryPause)
      }
      else {
        throw Error('Captcha error: ' + solution.request)
      }
    }
  }
}
