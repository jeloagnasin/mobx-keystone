import { assert, _ } from "spec.ts"
import {
  ActionCall,
  ActionContext,
  castModelFlow,
  castYield,
  getSnapshot,
  model,
  Model,
  modelAction,
  modelFlow,
  onActionMiddleware,
  prop,
} from "../../src"
import "../commonSetup"
import { autoDispose } from "../utils"

async function delay(x: number) {
  return new Promise<number>(r => setTimeout(() => r(x), x))
}

@model("P2")
export class P2 extends Model({
  y: prop(() => 0),
}) {
  @modelFlow
  addY = castModelFlow(function*(this: P2, n: number) {
    this.y += n / 2
    yield delay(50)
    this.y += n / 2
    return this.y
  })
}

@model("P")
export class P extends Model({
  p2: prop(() => new P2({})),
  x: prop(() => 0),
}) {
  @modelFlow
  addX = castModelFlow(function*(this: P, n: number) {
    this.x += n / 2
    const r = castYield(delay, yield delay(50))
    assert(r, _ as number)
    expect(r).toBe(50) // just to see yields return the right result
    this.addXSync(n / 4)
    const r2 = castYield(delay, yield delay(40))
    assert(r2, _ as number)
    expect(r2).toBe(40) // just to see yields return the right result
    this.x += n / 4
    return this.x
  })

  @modelAction
  addXSync(n: number) {
    this.x += n
    return n
  }

  @modelFlow
  addXY = castModelFlow(function*(this: P, n1: number, n2: number) {
    const r = castYield(this.addX, yield this.addX(n1))
    assert(r, _ as number)
    expect(typeof r).toBe("number")
    yield delay(50)
    yield this.p2.addY(n2)
    return n1 + n2
  })

  @modelFlow
  throwFlow = castModelFlow(function*(this: P, n: number) {
    this.x += n
    yield delay(50)
    throw new Error("flow failed")
  })
}

test("flow", async () => {
  const p = new P({})

  interface Event {
    actionCall: ActionCall
    context: ActionContext
  }

  const events: Event[] = []
  function reset() {
    events.length = 0
  }

  const disposer = onActionMiddleware(p, {
    onStart(actionCall, context) {
      events.push({
        actionCall,
        context,
      })
    },
  })
  autoDispose(disposer)

  reset()
  const ret = await p.addX(2)
  assert(ret, _ as number)
  expect(ret).toBe(2)
  expect(p.x).toBe(2)
  expect(getSnapshot(p).x).toBe(2)

  expect(events).toMatchInlineSnapshot(`
    Array [
      Object {
        "actionCall": Object {
          "actionName": "addX",
          "args": Array [
            2,
          ],
          "targetPath": Array [],
        },
        "context": Object {
          "actionName": "addX",
          "args": Array [
            2,
          ],
          "data": Object {
            Symbol(simpleDataContext): [Circular],
            Symbol(actionTrackingMiddlewareData): Object {
              "startAccepted": true,
              "state": "finished",
            },
          },
          "parentContext": undefined,
          "rootContext": [Circular],
          "target": P {
            "$": Object {
              "p2": P2 {
                "$": Object {
                  "y": 0,
                },
                "$modelType": "P2",
              },
              "x": 2,
            },
            "$modelType": "P",
          },
          "type": "async",
        },
      },
    ]
  `)

  reset()
  const ret2 = await p.addXY(4, 4)
  assert(ret2, _ as number)
  expect(ret2).toBe(8)
  expect(p.x).toBe(6)
  expect(p.p2.y).toBe(4)

  expect(events).toMatchInlineSnapshot(`
    Array [
      Object {
        "actionCall": Object {
          "actionName": "addXY",
          "args": Array [
            4,
            4,
          ],
          "targetPath": Array [],
        },
        "context": Object {
          "actionName": "addXY",
          "args": Array [
            4,
            4,
          ],
          "data": Object {
            Symbol(simpleDataContext): [Circular],
            Symbol(actionTrackingMiddlewareData): Object {
              "startAccepted": true,
              "state": "finished",
            },
          },
          "parentContext": undefined,
          "rootContext": [Circular],
          "target": P {
            "$": Object {
              "p2": P2 {
                "$": Object {
                  "y": 4,
                },
                "$modelType": "P2",
              },
              "x": 6,
            },
            "$modelType": "P",
          },
          "type": "async",
        },
      },
    ]
  `)

  // check rejection
  reset()
  const oldX = p.x
  try {
    await p.throwFlow(10)
    fail("flow must throw")
  } catch (err) {
    expect(err.message).toBe("flow failed")
  } finally {
    expect(p.x).toBe(oldX + 10)
  }
  expect(events).toMatchInlineSnapshot(`
    Array [
      Object {
        "actionCall": Object {
          "actionName": "throwFlow",
          "args": Array [
            10,
          ],
          "targetPath": Array [],
        },
        "context": Object {
          "actionName": "throwFlow",
          "args": Array [
            10,
          ],
          "data": Object {
            Symbol(simpleDataContext): [Circular],
            Symbol(actionTrackingMiddlewareData): Object {
              "startAccepted": true,
              "state": "finished",
            },
          },
          "parentContext": undefined,
          "rootContext": [Circular],
          "target": P {
            "$": Object {
              "p2": P2 {
                "$": Object {
                  "y": 4,
                },
                "$modelType": "P2",
              },
              "x": 16,
            },
            "$modelType": "P",
          },
          "type": "async",
        },
      },
    ]
  `)
})
