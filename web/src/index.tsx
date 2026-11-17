/*
  This file is ENTRY POINT to the entire web application.
  Only code that gets called at some point from this file (via imports or otherwise)
  will get executed in the browser window.
  Try to keep it clean and minimal in this file, and outsource aspects to more
  modular code in separate files, imported here and called.
*/

// Library Imports
import 'core-js/stable'
import 'regenerator-runtime/runtime'

import { WeaveClient, initializeHotReload, isWeaveContext } from '@theweave/api'
import createStoreAndRenderToDom, { electronInit } from './indexForElectron'
import {
  getAppWs,
  setAgentPubKey,
  setAppWs,
  setWeaveClient,
  setWeaveProfilesClient,
} from './hcWebsockets'
import {
  isAd4mMode,
  ad4mUrl,
  ad4mToken,
  stripCredentialParams,
} from './ad4m/mode'
import { Ad4mAppClient } from './ad4m/Ad4mAppClient'
import { setAgentAddress } from './redux/persistent/profiles/agent-address/actions'
import { setMyLocalProfile } from './redux/persistent/profiles/my-local-profile/actions'
import { readMyLocalProfile } from './utils'
import { AppClient, encodeHashToBase64 } from '@holochain/client'
import { getComponentAndPropsForRenderMode, mossInit } from './indexForMoss'
import { appletServices } from './weave/appletService'
import App from './routes/App.connector' // Import App for main view
import { WeaveClientRenderInfo } from './weave/WeaveClientRenderInfo'
import { routeForWal } from './weave/mainViewTarget'

const isWeaveDevMode = () => {
  return process.env.__DEV_MODE__ && !process.env.KANGAROO
}

;(async () => {
  if (isWeaveDevMode()) {
    await initializeHotReload()
  }
  if (isAd4mMode()) {
    // AD4M mode: the shim satisfies the AppClient surface the UI uses
    const executorUrl = ad4mUrl()
    const token = ad4mToken()
    // the token lives only in memory/storage now — take it off the address bar
    stripCredentialParams()
    const client = await Ad4mAppClient.connect(executorUrl, token)
    setAppWs(client as unknown as AppClient)
    const store = await createStoreAndRenderToDom(
      client as unknown as AppClient,
      App,
      { appWebsocket: client }
    )
    // the real conductor agent key arrives with the first cell's info();
    // until then appInfo reports a placeholder — refresh redux + the
    // hcWebsockets cache when it lands
    client.onAgentKey((key) => {
      setAgentPubKey(key)
      store.dispatch(setAgentAddress(encodeHashToBase64(key)))
      const profile = readMyLocalProfile()
      if (profile) store.dispatch(setMyLocalProfile(profile))
    })
    await electronInit(store, client as unknown as AppClient)
    return
  }
  if (!isWeaveContext()) {
    // electron
    console.log('IS NOT WEAVE CONTEXT')
    ;(async () => {
      const appWs = await getAppWs()
      const store = await createStoreAndRenderToDom(appWs, App, {
        appWebsocket: appWs,
      })
      await electronInit(store, appWs)
    })()
  } else {
    ;(async () => {
      const weaveClient = await WeaveClient.connect(appletServices)
      setWeaveClient(weaveClient)
      const weaveClientRenderInfo = new WeaveClientRenderInfo(
        weaveClient.renderInfo
      )
      if (!weaveClientRenderInfo.isAppletView()) {
        throw new Error('This Applet only implements the applet view.')
      }

      setAppWs(weaveClientRenderInfo.getAppletClient())
      setWeaveProfilesClient(weaveClientRenderInfo.getProfilesClient())

      const rootElementAndProps = getComponentAndPropsForRenderMode(
        weaveClientRenderInfo
      )
      let store: any

      store = await createStoreAndRenderToDom(
        weaveClientRenderInfo.getAppletClient(),
        rootElementAndProps.rootElement,
        rootElementAndProps.rootProps
      )
      await mossInit(
        store,
        weaveClientRenderInfo.getProfilesClient(),
        weaveClientRenderInfo.getAppletClient()
      )
      // Moss opened the main view on a project or card (e.g. "Switch to" in a
      // card's asset view): go there once the projects are known
      const mainViewWal = weaveClientRenderInfo.getMainViewWal()
      if (mainViewWal) {
        const route = routeForWal(mainViewWal, store.getState().cells.projects)
        if (route) window.location.hash = route
      }
    })()
  }
})()
