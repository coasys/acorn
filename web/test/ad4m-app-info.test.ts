// appInfo() must surface every mounted Acorn project as a *cloned* cell
// under cell_info.projects, carrying the DNA hash + agent key from the
// language's info() and the project seed as dna_modifiers.network_seed
// (useProjectStatusInfos reads the passphrase back out of it).
import { encodeHashToBase64 } from '@holochain/client'
import { Ad4mAppClient } from '../src/ad4m/Ad4mAppClient'
import { Ad4mRpc } from '../src/ad4m/rpc'
import { cellIdToString } from '../src/utils'

jest.mock('../src/ad4m/rpc')

const LANG = 'acornlang'

function fakeHash(byte: number): Uint8Array {
  const h = new Uint8Array(39)
  h.fill(byte)
  return h
}

function fakeCell(seed: string, dnaByte: number, agentByte: number) {
  const dna = fakeHash(dnaByte)
  const agent = fakeHash(agentByte)
  const info = {
    dnaHash: encodeHashToBase64(dna),
    agentPubKey: encodeHashToBase64(agent),
    agentDid: 'did:key:zX',
    ad4mDid: 'did:key:zY',
    seed,
    cellId: [encodeHashToBase64(dna), encodeHashToBase64(agent)],
  }
  const cellIdString = cellIdToString([dna, agent])
  return { dna, agent, info, cellIdString }
}

describe('Ad4mAppClient.appInfo', () => {
  test('two mounted cells -> two cloned cells with their seeds', async () => {
    const c1 = fakeCell('uid-seed-one', 1, 9)
    const c2 = fakeCell('uid-seed-two', 2, 9)

    localStorage.setItem(
      'acorn-ad4m-cells',
      JSON.stringify([
        {
          cellIdString: c1.cellIdString,
          uuid: 'uuid-1',
          lang: `${LANG}1`,
          info: c1.info,
          cloneId: 'projects.0',
          name: 'Acorn one',
        },
        {
          cellIdString: c2.cellIdString,
          uuid: 'uuid-2',
          lang: `${LANG}2`,
          info: c2.info,
          cloneId: 'projects.1',
          name: 'Acorn two',
        },
      ])
    )

    const rpcStub = {
      call: jest.fn(async (method: string, params: any) => {
        if (method === 'perspective.mounts') {
          return [params.uuid === 'uuid-1' ? `${LANG}1` : `${LANG}2`]
        }
        throw new Error(`unexpected rpc ${method}`)
      }),
      onEvent: jest.fn(),
      close: jest.fn(),
    }
    ;(Ad4mRpc.connect as jest.Mock).mockResolvedValue(rpcStub)

    const client = await Ad4mAppClient.connect('ws://unused')
    const info = await client.appInfo()

    const cells = info.cell_info['projects']
    expect(cells).toHaveLength(2)
    for (const cellInfo of cells) {
      expect(cellInfo.type).toBe('cloned')
    }
    const [clone1, clone2] = cells.map((c) => (c as any).value)

    expect(clone1.dna_modifiers.network_seed).toBe('uid-seed-one')
    expect(clone2.dna_modifiers.network_seed).toBe('uid-seed-two')
    expect(clone1.cell_id).toEqual([c1.dna, c1.agent])
    expect(clone2.cell_id).toEqual([c2.dna, c2.agent])
    expect(clone1.clone_id).toBe('projects.0')
    expect(clone2.clone_id).toBe('projects.1')
    expect(clone1.enabled).toBe(true)

    // the shared conductor agent key is learned from the cells' info()
    expect(info.agent_pub_key).toEqual(c1.agent)
    expect(info.status).toEqual({ type: 'enabled' })
  })

  test('stale cells whose perspective no longer mounts the language are dropped', async () => {
    const c1 = fakeCell('uid-seed-one', 1, 9)
    localStorage.setItem(
      'acorn-ad4m-cells',
      JSON.stringify([
        {
          cellIdString: c1.cellIdString,
          uuid: 'gone',
          lang: `${LANG}1`,
          info: c1.info,
          cloneId: 'projects.0',
          name: 'Acorn one',
        },
      ])
    )
    const rpcStub = {
      call: jest.fn(async () => []), // mounts: nothing mounted
      onEvent: jest.fn(),
      close: jest.fn(),
    }
    ;(Ad4mRpc.connect as jest.Mock).mockResolvedValue(rpcStub)

    const client = await Ad4mAppClient.connect('ws://unused')
    const info = await client.appInfo()
    expect(info.cell_info['projects']).toHaveLength(0)
    // the persisted cell was dropped
    expect(JSON.parse(localStorage.getItem('acorn-ad4m-cells')!)).toHaveLength(
      0
    )
  })
})
