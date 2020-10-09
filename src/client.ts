import net from "net"
import sleep from "sleep-promise"
import { MessageQueue, Task } from "./@types/types"

/**
 * Creates a MessageQueue object which represents a tcp connection to the message queue server.
 *
 * @param host - the hostname of a running message queue server
 * @param port - the corresponding port
 * @param jsonMode - when set to true only accepts and returns json objects as tasks
 *
 * @returns the readonly MessageQueue object
 */
export async function getMessageQueue(
  host: string,
  port: number,
  jsonMode: boolean = false
): Promise<Readonly<MessageQueue>> {
  const client = new net.Socket()
  const queue: MessageQueue = {
    host: host,
    port: port,
    client: client,
    active: false,
    jsonMode: jsonMode,
  }

  return new Promise((resolve, reject) => {
    client.on("error", (error) => {
      reject(new Error(error.toString()))
    })

    client.connect(port, host, () => {
      queue.active = true
      resolve(queue)
    })
  })
}

/**
 * Closes the message queue by sending an END message to the server
 *
 * @param queue - the message queue object of the connection you want to close
 *
 * @returns a MessageQueue object representing the changes
 */
export function closeMessageQueue(
  queue: Readonly<MessageQueue>
): Readonly<MessageQueue> {
  queue.client.write("END\n")
  return {
    host: queue.host,
    port: queue.port,
    client: queue.client,
    active: false,
    jsonMode: queue.jsonMode,
  }
}

/**
 * Asks the message queue for a task. Optionally you can specify which queue (a message queue server manages multiple ones)
 * you want to query.
 *
 * @param queue - the message queue object you want to access
 * @param from - an optional queue name matching /[A-Za-z]+/
 * @param refreshConnection - Optional. By default the function tries to reach the server a second time if the
 * connection times out the first time. When setting refreshConnection to true, it establishes a new connection directly and
 * thus does not try a second time.
 *
 * @returns a readonly object representing the received task, or null if no task was available
 */
export async function getTask(
  queue: Readonly<MessageQueue>,
  from: string = "",
  refreshConnection: boolean = false
): Promise<Readonly<Task> | null> {
  if (!queue.active || refreshConnection) {
    queue = await getMessageQueue(queue.host, queue.port, queue.jsonMode)
  }

  const task: Task = {
    parent: queue,
    data: "",
  }

  return new Promise(async (resolve, reject) => {
    let barrier = false

    // register listeners for relevant events
    registerOneTimeEvents({
      socket: queue.client,
      data: (data: string | Buffer) => {
        barrier = true

        const regex = /WANT\? (.+)/
        const match = regex.exec(data.toString())

        if (match != null) {
          task.data = match[1]

          if (queue.jsonMode) {
            try {
              task.data = JSON.parse(task.data)
            } catch (err) {
              resolve(null)
              return
            }
          }

          resolve(task)
        } else {
          resolve(null)
        }
      },
      error: async (error) => {
        barrier = true

        if (!refreshConnection) {
          // if this isnt already the second attempt, try again.

          // we try twice because the connection may have timed out. If the connection
          // fails again, we assume that the server is not reachable and throw an error.
          try {
            const task = await getTask(queue, from, true)
            resolve(task)
          } catch (error) {
            reject(new Error(error))
          }
        } else {
          reject(new Error(error))
        }
      },
    })

    // send ASK message
    const message = `ASK ${from}\n`
    queue.client.write(message)

    setTimeout(() => {
      if (!barrier) {
        reject(new Error("No response after 5000ms"))
      }
    }, 5000)
  })
}

/**
 * Reschedules a task.
 *
 * @param task - the task you want to reschedule
 */
export async function rescheduleTask(task: Readonly<Task>) {
  await scheduleTask(task.parent, task.data, task.origin ?? null)
}

/**
 * Schedules a new task for the message queue to manage. Optionally you can supply a queue name (see getTask).
 *
 * @remarks
 * Due to the design of the protocol (no confirmations for scheduled tasks), the function cannot guarantee that the task scheduling
 * was successful. For that reason we allow to set a timeout during which the function listens for tcp errors. After expiration we
 * just assume the scheduling was successful.
 *
 * @param queue - the message queue for which you want to schedule the task
 * @param task - a string or an object representing the task
 * @param timeout - the time after which to assume that the scheduling was successful
 * @param refreshConnection - should the connection be refreshed preemptively (see getTask)
 *
 * @returns a message queue object representing the changes
 */
export async function scheduleTask(
  queue: Readonly<MessageQueue>,
  task: string | object,
  forQueue: string | null,
  timeout: number = 1000,
  refreshConnection: boolean = false
): Promise<Readonly<MessageQueue>> {
  if (!queue.active || refreshConnection) {
    queue = await getMessageQueue(queue.host, queue.port, queue.jsonMode)
  }

  return new Promise(async (resolve, reject) => {
    if (queue.jsonMode && typeof task != "object") {
      reject(new Error("Task has to be an object when using jsonMode"))
      return
    }

    let barrier = false

    // register listeners for relevant events
    registerOneTimeEvents({
      socket: queue.client,
      error: async (error) => {
        barrier = true
        if (!refreshConnection) {
          // if this isnt already the second attempt, try again.

          // we try twice because the connection may have timed out. If the connection
          // fails again, we assume that the server is not reachable and throw an error.
          try {
            const q = await scheduleTask(queue, task, forQueue, timeout, true)
            resolve(q)
          } catch (error) {
            reject(error)
          }
        } else {
          reject(error)
        }
      },
    })

    if (typeof task == "object") {
      task = JSON.stringify(task)
    }

    // send SCHED message
    const message =
      forQueue != null ? `SCHED ${task}@${forQueue}\n` : `SCHED ${task}\n`
    queue.client.write(message)

    if (!refreshConnection) {
      // wait for potential errors
      await sleep(timeout)
    }

    // barrier is true if an error occurred
    if (barrier) {
      return
    }

    resolve(queue)
  })
}

/**
 * Marks the last task received as accepted.
 *
 * @remarks
 * Due to the design of the protocol error handling is difficult. To acknowledge a task, the protocol does not need any
 * metadata and just assumes the last task send over the socket should be acknowledged. If the socket crashes in the
 * meantime, that information is obviously lost. To handle some of those errors, we can supply an onError listener
 * that is called when encountering tcp errors.
 *
 * @param queue - the message queue that supplied the last task
 * @param onError - an optional error handler
 */
export function acceptLastTask(
  queue: Readonly<MessageQueue>,
  onError: () => void = () => {}
) {
  // we are a bit limited by the protocol here. We can only accept the last task we received
  // and that only if the tcp connection didn't terminate in between. To work with these
  // limitations, we can pass an optional, error handling callback function.
  registerOneTimeEvents({
    socket: queue.client,
    error: (_) => {
      onError()
    },
  })

  queue.client.write("ACK\n")
}

/**
 * Marks the last task received as declined.
 *
 * @remarks
 * Due to the design of the protocol error handling is difficult. To decline a task, the protocol does not need any
 * metadata and just assumes the last task send over the socket should be decline. If the socket crashes in the
 * meantime, that information is obviously lost. To handle some of those errors, we can supply an onError listener
 * that is called when encountering tcp errors. In this case we could there reschedule the event manually.
 *
 * @param queue - the message queue that supplied the last task
 * @param onError - an optional error handler
 */
export function declineLastTask(
  queue: Readonly<MessageQueue>,
  onError: () => void = () => {}
) {
  // same limitations as acceptLastTask
  registerOneTimeEvents({
    socket: queue.client,
    error: (_) => {
      onError()
    },
  })

  queue.client.write("DCL\n")
}

/**
 * Marks the last task received as deleted.
 *
 * @remarks
 * Due to the design of the protocol error handling is difficult. To delete a task, the protocol does not need any
 * metadata and just assumes the last task send over the socket should be deleted. If the socket crashes in the
 * meantime, that information is obviously lost. To handle some of those errors, we can supply an onError listener
 * that is called when encountering tcp errors.
 *
 * @param queue - the message queue that supplied the last task
 * @param onError - an optional error handler
 */
export function deleteLastTask(
  queue: Readonly<MessageQueue>,
  onError: () => void = () => {}
) {
  // same limitations as acceptLastTask
  registerOneTimeEvents({
    socket: queue.client,
    error: (_) => {
      onError()
    },
  })

  queue.client.write("DEL\n")
}

function registerOneTimeEvents({
  socket,
  data = (_) => {},
  error = (_) => {},
}: {
  socket: net.Socket
  data?: (data: string | Buffer) => any
  error?: (error: any) => any
}) {
  function data_one_time(dat: string | Buffer) {
    data(dat)
    socket.off("data", data_one_time)
  }

  function error_one_time(err: any) {
    error(err)
    socket.off("error", error_one_time)
  }

  socket.on("data", data_one_time)
  socket.on("error", error_one_time)
}
