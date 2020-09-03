import got from 'got'
import { sleep } from '../utils'
import {CaptchaType, SolverOptions} from "./index";

const tcRetryPause = 5000
const tcInitialPause = 15000
const tcUrlApiReq = 'https://2captcha.com/in.php'
const tcUrlApiResult = 'https://2captcha.com/res.php'


export default async function solve({ url, sitekey, type }: SolverOptions): Promise<string> {
  if (type != 'hCaptcha')
    throw 'Unsupported captcha type: ' + type

  const apikey = process.env.TWOCAPTCHA_APIKEY

  const reqUrl = tcUrlApiReq + '?key=' + apikey + '&method=hcaptcha' + '&sitekey=' + sitekey + '&pageurl=' + url + '&json=1'
  const resp = await got(reqUrl)

  console.log(resp.body);
  const content = JSON.parse(resp.body)

  if (content.status != 1)
    throw '2Captcha returned error: ' + content.request

  await sleep(tcInitialPause)

  const respUrl = tcUrlApiResult + '?key=' + apikey + '&id=' + content.request + '&json=1&action=get'
  while(true) {
    const result = await got(respUrl)

    const solution = JSON.parse(result.body)

    if(solution.request === 'CAPCHA_NOT_READY') {
      await sleep(tcRetryPause)
    }
    else {
      return solution.request
    }
  }
}
