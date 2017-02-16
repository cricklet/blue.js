/* @flow */

import * as readline from 'readline'
import * as process from 'process'

import SocketServer from 'socket.io'
import SocketClient from 'socket.io-client'

import {
  OTClient,
  OTServer,
  OTHelper,
  castServerBroadcast,
  castClientUpdate
} from './js/ot/orchestrator.js'

import type {
  ClientUpdate,
  ServerBroadcast,
  OTServerDocument,
} from './js/ot/orchestrator.js'

import type {
  DocumentState
} from './js/ot/operations.js'

import {
  Transformer,
  TextApplier,
  inferOps,
} from './js/ot/operations.js'


import { allEqual, asyncSleep, remove, insert, genUid, pop, filterInPlace, subarray, NotifyOnce } from './js/ot/utils.js'
import { find } from 'wu'

let PORT = 9643
let URL = `http://localhost:${PORT}`

let TextOTHelper = new OTHelper(Transformer, TextApplier)

let docId = '1234'

let server = SocketServer();
let documents: {[docId: string]: OTServerDocument<*,*>} = {}

function getDocument(docId: string): OTServerDocument<*,*> {
  if (docId in documents) {
  } else { documents[docId] =  { state: '', log: [] } }
  return documents[docId]
}

function serverHandler(docId: string, clientUpdate: ClientUpdate<*>): ?ServerBroadcast<*> {
  let doc = getDocument(docId)
  let server = new OTServer(TextOTHelper, doc)
  let serverUpdate = server.handleUpdate(clientUpdate)
  return serverUpdate
}

function serializeServerUpdate(broadcast: ServerBroadcast<*>): string {
  return JSON.stringify(broadcast)
}

function deserializeServerUpdate(json: string): ServerBroadcast<*> {
  return JSON.parse(json)
}

function serializeClientUpdate(docId: string, update: ClientUpdate<*>): string {
  return JSON.stringify({
    docId: docId,
    update: update
  })
}

function deserializeClientUpdate(json: string): [string, ClientUpdate<*>] {
  let packet = JSON.parse(json)
  return [ packet.docId, packet.update ]
}

server.on('connection', (socket) => {
  socket.on('open document', (docId) => {
    socket.join(docId)
  })
  socket.on('client update', (json) => {
    let [docId, clientUpdate] = deserializeClientUpdate(json)
    let serverUpdate = serverHandler(docId, clientUpdate)
    if (serverUpdate == null) { return }
    let serverUpdateJSON = serializeServerUpdate(serverUpdate)

    server.sockets.in(docId).emit('server update', serverUpdateJSON)
  })
})

server.listen(PORT)

function createClient(clientId, docId) {
  let client = SocketClient(URL)
  client.emit('open document', docId)

  let otClient = new OTClient(TextOTHelper)

  client.on('server update', (json) => {
    let serverUpdate = deserializeServerUpdate(json)

    let clientUpdate = otClient.handleBroadcast(serverUpdate)
    console.log(clientId, otClient.state)

    if (clientUpdate != null) {
      let clientUpdateJSON = serializeClientUpdate(docId, clientUpdate)
      client.emit('client update', clientUpdateJSON)
    }
  })

  return {
    update: (newText: string) => {
      console.log(clientId, 'UPDATE', newText)

      let ops = inferOps(otClient.state, newText)
      if (ops == null) { return }

      let clientUpdate = otClient.handleEdit(ops)

      if (clientUpdate != null) {
        let clientUpdateJSON = serializeClientUpdate(docId, clientUpdate)
        client.emit('client update', clientUpdateJSON)
      }
    },
    current: () => {
      return otClient.state
    }
  }
}

let c0 = createClient('CLIENT0', 'DOC0')
let c1 = createClient('CLIENT1', 'DOC0')
let c2 = createClient('CLIENT2', 'DOC0')

let cs = [c0, c1, c2]


let WORDS = [
  "lorem", "ipsum", "dolor", "sit", "amet", "consectetur", "adipiscing",
  "elit", "nullam", "sit", "amet", "nulla", "non", "est", "finibus",
  "mollis", "nulla", "in", "felis", "eu", "felis", "vehicula", "viverra",
  "id", "lobortis", "massa", "aliquam", "mi", "dolor", "aliquet", "a",
  "volutpat", "vitae", "porta", "tempor", "eros", "vestibulum", "sit",
  "amet", "commodo", "ex", "vestibulum", "ante", "ipsum", "primis", "in",
  "faucibus", "orci", "luctus", "et", "ultrices", "posuere", "cubilia", "curae",
  "in", "dapibus", "sollicitudin", "est", "vel", "convallis", "class", "aptent",
  "taciti", "sociosqu", "ad", "litora", "torquent", "per", "conubia", "nostra",
  "per", "inceptos", "himenaeos"
]

function pickRandom<T>(arr: T[]): T {
  let i = Math.floor(Math.random() * arr.length)
  return arr[i]
}

function addWord(text) {
  let words = text.split(' ')
  let word = pickRandom(WORDS)
  let i = Math.floor(Math.random() * words.length)
  return insert(words, word, i).join(' ')
}

function deletePortion(text) {
  let words = text.split(' ')
  let i = Math.floor(Math.random() * words.length)
  return remove(words, i).join(' ')
}

function adjust(c) {
  if (Math.random() > 0.5) {
    c.update(addWord(c.current()))
  } else {
    c.update(deletePortion(c.current()))
  }
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
})

let shouldAdjust = false

;(async () => {
  while (true) {
    await asyncSleep(500)

    if (shouldAdjust) {
      adjust(c0)
      adjust(c1)
      adjust(c2)
    }
  }
})()

rl.on('line', (input) => {
  if (input === 'start') {
    shouldAdjust = true
  }

  if (input === 'stop') {
    shouldAdjust = false
  }

  if (input === 'status') {
    let syncd = allEqual(cs.map(c => c.current()))
    if (syncd) {
      console.log('synchronized as:', c0.current())
    } else {
      console.log('not yet synchronized:', c0.current())
    }
  }
})
