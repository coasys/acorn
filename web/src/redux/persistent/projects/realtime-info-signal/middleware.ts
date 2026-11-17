import {
  OPEN_EXPANDED_VIEW,
  CLOSE_EXPANDED_VIEW,
} from '../../../ephemeral/expanded-view/actions'
import {
  START_TITLE_EDIT,
  END_TITLE_EDIT,
  START_DESCRIPTION_EDIT,
  END_DESCRIPTION_EDIT,
} from '../../../ephemeral/outcome-editing/actions'
import { SEND_REALTIME_INFO, SEND_EXIT_PROJECT_SIGNAL } from './actions'
import ProjectsZomeApi from '../../../../api/projectsApi'
import { cellIdFromString } from '../../../../utils'
import { RootState } from '../../../reducer'
import { CellIdString } from '../../../../types/shared'
import { AppClient, AppWebsocket, WsClient } from '@holochain/client'
import { getAppWs } from '../../../../hcWebsockets'

const isOneOfRealtimeInfoAffectingActions = (action) => {
  const { type } = action
  return (
    type === OPEN_EXPANDED_VIEW ||
    type === CLOSE_EXPANDED_VIEW ||
    type === START_TITLE_EDIT ||
    type === END_TITLE_EDIT ||
    type === START_DESCRIPTION_EDIT ||
    type === END_DESCRIPTION_EDIT ||
    type === SEND_REALTIME_INFO
  )
}

const isProjectExitAction = (action: { type: string }) => {
  const { type } = action
  return type === SEND_EXIT_PROJECT_SIGNAL
}
// watch for actions that will affect the realtime info state values

/** What the AD4M shim exposes for local edit-baseline capture
 *  (Ad4mAppClient.captureEditBaselines); absent on stock clients. */
interface EditBaselineCapturer {
  captureEditBaselines?: (
    projectId: CellIdString | null | undefined,
    realtimeInfo: any
  ) => void
}

// return the action handler middleware
const realtimeInfoWatcher =
  // closure the appWebsocket
  (_appWebsocket: AppClient) =>
    // provide the typical redux middleware signature
    (store: any) => (next: any) => async (action: any) => {
      if (isOneOfRealtimeInfoAffectingActions(action)) {
        const appWebsocket = await getAppWs()
        const projectsZomeApi = new ProjectsZomeApi(appWebsocket)
        let result = next(action)
        let state: RootState = store.getState()
        const payload = getRealtimeInfo(state)
        // AD4M mode: capture the edit-session baselines this action
        // implies locally and synchronously — a transport that is not
        // OPEN must not leave the next save diffing against the stale
        // view-open snapshot. The send below still waits for OPEN.
        ;(appWebsocket as EditBaselineCapturer).captureEditBaselines?.(
          payload.projectId,
          payload
        )
        // client 0.21 widened AppWebsocket.client from the concrete WsClient to
        // the AppClientTransport interface (request + on only), so `.socket` is
        // no longer on the declared type. The runtime object is unchanged when
        // the transport IS a WsClient, which is the case for every path acorn
        // uses, so this restores the 0.6 typing without changing the expression.
        const wsClient = (appWebsocket as AppWebsocket).client as unknown as WsClient
        if (wsClient.socket.readyState === wsClient.socket.OPEN) {
          // there is a chance that the project has been exited
          // and thus this need not be fired
          if (payload.projectId) {
            const cellId = cellIdFromString(payload.projectId)
            projectsZomeApi.realtimeInfoSignal
              .send(cellId, payload)
              .catch((e) => {
                console.log(
                  'could not send realtime info signal due to error:',
                  e
                )
              })
          }
        }
        return result
      } else if (isProjectExitAction(action)) {
        const appWebsocket = await getAppWs()
        const projectsZomeApi = new ProjectsZomeApi(appWebsocket)
        const payload = {
          projectId: '',
          outcomeBeingEdited: null,
          outcomeExpandedView: null,
        }
        const cellIdString: CellIdString = action.payload
        const cellId = cellIdFromString(cellIdString)
        // the emit this send produces drops every baseline of the cell;
        // run the same cleanup locally so a dead socket cannot skip it
        ;(appWebsocket as EditBaselineCapturer).captureEditBaselines?.(
          cellIdString,
          payload
        )
        // TODO: catch and log error, but don't
        // await this call
        projectsZomeApi.realtimeInfoSignal.send(cellId, payload).catch((e) => {
          console.log('could not send realtime info signal due to error:', e)
        })
        return next(action)
      } else {
        return next(action)
      }
    }

// cherry-pick the relevant state for sending as a RealtimeInfo Signal
function getRealtimeInfo(state: RootState) {
  return {
    projectId: state.ui.activeProject,
    outcomeBeingEdited: state.ui.outcomeEditing,
    outcomeExpandedView: state.ui.expandedView.outcomeActionHash,
  }
}
export { realtimeInfoWatcher }
