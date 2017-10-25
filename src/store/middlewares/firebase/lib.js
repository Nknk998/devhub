// @flow

import moment from 'moment'

import {
  fixFirebaseKey,
  fixFirebaseKeysFromObject,
  getMapAnalysis,
  getObjectFilteredByMap,
  getRelativePathFromRef,
  transformObjectToDeepPaths,
} from './helpers'

import { get, isObjectOrMap, map as _map } from '../../../utils/immutable'

export function createFirebaseHandler({
  blacklist,
  callback,
  debug = __DEV__,
  eventName,
  ignoreFn,
  map,
  rootDatabaseRef,
}) {
  const counterMap = {}

  return snapshot => {
    const fullPath = getRelativePathFromRef(snapshot.ref, rootDatabaseRef)
    const firebasePathArr = fullPath.split('/').filter(Boolean)
    const statePathArr = firebasePathArr.map(path =>
      fixFirebaseKey(path, false),
    )

    let value = snapshot.val()
    let blacklisted = false
    let ignore = false

    counterMap[fullPath] = (counterMap[fullPath] || 0) + 1

    if (eventName === 'value' && isObjectOrMap(value)) {
      value = getObjectFilteredByMap(value, map)
    } else {
      blacklisted =
        blacklist && blacklist.length && blacklist.includes(snapshot.key)
    }

    if (
      ignoreFn &&
      ignoreFn({
        count: counterMap[fullPath],
        eventName,
        firebasePathArr,
        statePathArr,
      })
    )
      ignore = true

    // TODO: check map here to prevent unnecessary callback (= redux actions)?
    // if (dont fits on map) ignore = true

    if (debug) {
      const action = blacklisted
        ? 'Blacklisted'
        : ignore ? 'Ignored' : 'Received'

      console.debug(
        `[FIREBASE] ${action} ${eventName} on ${fullPath || '/'}`,
        value,
      )
    }

    if (blacklisted || ignore) {
      return
    }

    value = fixFirebaseKeysFromObject(value, false)

    if (typeof callback === 'function') {
      callback({
        eventName,
        firebasePathArr,
        statePathArr,
        value,
      })
    }
  }
}

export const addFirebaseListener = ({
  blacklist,
  callback,
  debug = __DEV__,
  eventName,
  ignoreFn,
  map,
  once,
  ref,
  rootDatabaseRef,
  ...rest
}) => {
  const fullPath = getRelativePathFromRef(ref, rootDatabaseRef)
  let message = `[FIREBASE] Watching ${fullPath || '/'} ${eventName}${once
    ? ' once'
    : ''}`

  if (blacklist && blacklist.length) {
    message = `${message}, except ${blacklist.join(', ')}`
  }

  if (debug && !rest.isRecursiveCall) console.debug(message)

  if (eventName === 'children' || Array.isArray(eventName)) {
    const eventNames = Array.isArray(eventName)
      ? eventName
      : ['child_added', 'child_changed', 'child_removed']

    eventNames.forEach(realEventName => {
      addFirebaseListener({
        ...rest,
        blacklist,
        callback,
        debug,
        eventName: realEventName,
        ignoreFn,
        map,
        once,
        ref,
        rootDatabaseRef,
        isRecursiveCall: true,
      })
    })

    return
  }

  if (once) {
    ref.once(
      eventName,
      createFirebaseHandler({
        blacklist,
        callback,
        debug,
        eventName,
        ignoreFn,
        map,
        once,
        rootDatabaseRef,
      }),
    )
  } else {
    ref.on(
      eventName,
      createFirebaseHandler({
        blacklist,
        callback,
        debug,
        eventName,
        ignoreFn,
        map,
        once,
        rootDatabaseRef,
      }),
    )
  }
}

export function watchFirebaseFromMap({
  callback,
  debug = __DEV__,
  ignoreFn,
  map,
  once,
  rootDatabaseRef,
  ref = rootDatabaseRef,
  ...rest
}) {
  const mapAnalysis = getMapAnalysis(map)
  if (!mapAnalysis) return

  const { blacklist, count, hasAsterisk, objects, whitelist } = mapAnalysis

  objects.forEach(field => {
    watchFirebaseFromMap({
      ...rest,
      callback,
      debug,
      ignoreFn,
      map: get(map, field),
      once,
      ref: ref.child(field),
      rootDatabaseRef,
    })
  })

  if (count === 0 || (hasAsterisk && count === 1)) {
    // passed an empty object, so listen to it's children
    addFirebaseListener({
      ...rest,
      callback,
      debug,
      eventName: 'children',
      ignoreFn,
      map,
      once,
      ref,
      rootDatabaseRef,
    })
  } else if (blacklist.length) {
    // listen to all children, except the ones specified
    addFirebaseListener({
      ...rest,
      blacklist,
      callback,
      debug,
      eventName: 'children',
      ignoreFn,
      map,
      once,
      ref,
      rootDatabaseRef,
    })
  } else if (whitelist.length) {
    // listen only to the specified children
    whitelist.forEach(field =>
      addFirebaseListener({
        ...rest,
        callback,
        debug,
        eventName: 'value',
        ignoreFn,
        map,
        once,
        ref: ref.child(field),
        rootDatabaseRef,
      }),
    )
  }
}

export const applyPatchOnFirebase = ({
  debug = __DEV__,
  patch,
  rootDatabaseRef,
  ref = rootDatabaseRef,
}) => {
  if (!(ref && patch && isObjectOrMap(patch))) return

  const updatePatch = transformObjectToDeepPaths(patch, { encrypt: true })

  // console.log('applyPatchOnFirebase', {
  //   patch: toJS(patch),
  //   updatePatch: toJS(updatePatch),
  // })

  _map(updatePatch, (value, path) => {
    if (debug) {
      const fullPath = `${getRelativePathFromRef(ref, rootDatabaseRef)}/${path}`
      console.debug(`[FIREBASE] Patching on ${fullPath || '/'}`, value)
    }

    // value fixes
    let _value = value
    if (isObjectOrMap(_value)) _value = fixFirebaseKeysFromObject(_value, true)
    else if (_value instanceof Date) _value = moment(_value).toISOString()
    else if (Number.isNaN(_value)) _value = 0

    return _value
  })

  ref.update(updatePatch)
}
