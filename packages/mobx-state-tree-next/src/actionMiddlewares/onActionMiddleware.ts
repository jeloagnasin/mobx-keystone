import { isObservable, toJS } from "mobx"
import { ActionCall } from "../action/applyAction"
import { ActionContext } from "../action/context"
import { ActionMiddleware } from "../action/middleware"
import { SpecialAction } from "../action/specialActions"
import { Model } from "../model/Model"
import { getRootPath } from "../parent/path"
import { getSnapshot } from "../snapshot/getSnapshot"
import { isTweakedObject } from "../tweaker/core"
import { assertIsObject, failure, isPlainObject, isPrimitive } from "../utils"

export type OnActionListener = (
  actionCall: ActionCall,
  actionContext: ActionContext,
  next: () => any
) => void

/**
 * Creates an action middleware that invokes a listener for a given action / all actions of a given tree.
 * Remember to `return next()` if you want to continue the action or throw if you want to cancel it.
 * Note that `onActionMiddleware` will only run for the topmost level actions, so it won't run for child actions or intermediary flow steps.
 * Also it won't trigger the listener for calls to hooks such as `onAttachedToRootStore` or its returned disposer.
 *
 * If you want to ensure that the actual action calls are serializable you should use either `serializeActionCallArgument` over the arguments before
 * sending the action call over the wire / storing them or `serializeActionCall`.
 *
 * @param target Root target model object. If `actionName` is provided it will only run for that particular action.
 * @param listener Listener function that will be invoked everytime a topmost action is invoked on the model or any children.
 * @returns The actual middleware to be passed to `addActionMiddleware`.
 */
export function onActionMiddleware<M extends Model>(
  target: {
    model: M
    actionName?: keyof M
  },
  listener: OnActionListener
): ActionMiddleware {
  assertIsObject(target, "target")

  const { model, actionName } = target

  if (!(model instanceof Model)) {
    throw failure("target.model must be a model")
  }

  if (actionName && typeof model[actionName] !== "string") {
    throw failure("target.actionName must be a string or undefined")
  }

  const filter: ActionMiddleware["filter"] = ctx => {
    if (ctx.parentContext || ctx.previousAsyncStepContext) {
      // sub-action or async step, do nothing
      return false
    }

    if (actionName && ctx.name !== actionName) {
      return false
    }

    // skip hooks
    if (
      ctx.name === SpecialAction.OnAttachedToRootStore ||
      ctx.name === SpecialAction.OnAttachedToRootStoreDisposer
    ) {
      return false
    }

    return true
  }

  return {
    middleware(ctx, next) {
      if (ctx.parentContext || ctx.previousAsyncStepContext) {
        // sub-action or async step, do nothing
        return next()
      }

      const actionCall = actionContextToActionCall(ctx)

      return listener(actionCall, ctx, next)
    },
    target: model,
    filter,
  }
}

function actionContextToActionCall(ctx: ActionContext): ActionCall {
  const rootPath = getRootPath(ctx.target)

  return {
    name: ctx.name,
    args: ctx.args,
    path: rootPath.path,
  }
}

/**
 * Transforms an action call argument by returning its serializable equivalent.
 * In more detail, this will return the snapshot of models, the non observable equivalent of observable values,
 * or if it is a primitive then the primitive itself.
 * If the value cannot be serialized it will throw an exception.
 *
 * @param value Argument value to be transformed into its serializable form.
 * @returns The serializable form of the passed value.
 */
export function serializeActionCallArgument(value: any): any {
  if (isPrimitive(value)) {
    return value
  }
  if (isTweakedObject(value)) {
    return getSnapshot(value)
  }

  const origValue = value
  if (isObservable(value)) {
    value = toJS(value, { exportMapsAsObjects: false, detectCycles: false })
  }
  if (isPlainObject(value) || Array.isArray(value)) {
    return value
  }

  throw failure(`serializeActionCallArgument could not serialize the given value: ${origValue}`)
}

/**
 * Ensures that an action call is serializable by mapping the action arguments into its
 * serializable version by using `serializeActionCallArgument`.
 *
 * @param actionCall Action call to convert.
 * @returns The serializable action call.
 */
export function serializeActionCall(actionCall: ActionCall): ActionCall {
  return {
    ...actionCall,
    args: actionCall.args.map(serializeActionCallArgument),
  }
}
