import net from "net"
import sleep from "sleep-promise"
import { MessageQueue, Task } from "./@types/types"

export async function getMessageQueue(
  host: string,
  port: number
): Promise<Readonly<MessageQueue>> {
  const client = new net.Socket()
  const queue: MessageQueue = {
    host: host,
    port: port,
    client: client,
    active: false,
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

export function closeMessageQueue(
  queue: Readonly<MessageQueue>
): Readonly<MessageQueue> {
  queue.client.write("END")
  return {
    host: queue.host,
    port: queue.port,
    client: queue.client,
    active: false,
  }
}

export async function getTask(
  queue: Readonly<MessageQueue>,
  from: string = "",
  retry: boolean = false
): Promise<Readonly<Task> | null> {
  if (!queue.active || retry) {
    queue = await getMessageQueue(queue.host, queue.port)
  }

  const task: Task = {
    parent: queue,
    data: "",
  }

  return new Promise((resolve, reject) => {
    // register listeners for relevant events
    registerOneTimeEvents({
      socket: queue.client,
      data: (data: string | Buffer) => {
        const regex = /WANT\? (.+)/
        const match = regex.exec(data.toString())

        if (match != null) {
          task.data = match[1]
          resolve(task)
        } else {
          resolve(null)
        }
      },
      error: async (error) => {
        if (!retry) {
          // if this isnt already the second attempt, try again.

          // we try twice because the connection may have timed out. If the connection
          // fails again, we assume that the server is not reachable and throw an error.
          try {
            const task = await getTask(queue, from, true)
            resolve(task)
          } catch (error) {
            reject(error)
          }
        } else {
          reject(error)
        }
      },
    })

    // send ASK message
    const message = `ASK ${from}`
    queue.client.write(message)
  })
}

export async function rescheduleTask(task: Readonly<Task>) {
  await scheduleTask(task.parent, task.data, task.origin ?? null)
}

export async function scheduleTask(
  queue: Readonly<MessageQueue>,
  task: string | object,
  forQueue: string | null,
  timeout: number = 1000,
  refreshConnection: boolean = false
): Promise<Readonly<MessageQueue>> {
  if (!queue.active || refreshConnection) {
    queue = await getMessageQueue(queue.host, queue.port)
  }

  return new Promise(async (resolve, reject) => {
    // register listeners for relevant events

    let barrier = false

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
      forQueue != null ? `SCHED ${task}@${forQueue}` : `SCHED ${task}`
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

  queue.client.write("ACK")
}

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

  queue.client.write("DCL")
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
  socket.on("data", (p: string | Buffer) => {
    data(p)

    // only capture the first data event
    socket.on("data", () => {})
  })

  socket.on("error", (p) => {
    error(p)
    // only capture the first error event
    socket.on("error", () => {})
  })
}
