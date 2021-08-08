import { SolverOptions } from '.'

// @ts-ignore As a fork I dont feel like dealing with this compiler error, it works fine if it compiles
export default async function solve({ url, sitekey, userAgent, proxy, apiKey }: SolverOptions): Promise<string> {
    try {
        const ac = require("@antiadmin/anticaptchaofficial")
        ac.setAPIKey(apiKey)
        const parsedProxy = proxy.split('://')[1].split(':')
        const token = ac.solveHCaptchaProxyOn(url, sitekey, 'socks5', parsedProxy[0], parsedProxy[1], null, null, userAgent)
        return token    
    } catch (e) {
        console.error(e)
        return null
    }
}
