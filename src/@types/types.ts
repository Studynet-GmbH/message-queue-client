import { Socket } from "net"

export interface MessageQueue {
  host: string
  port: number
  client: Socket
  active: boolean
}

export interface Task {
  parent: Readonly<MessageQueue>
  data: string | object
  origin?: string
}
