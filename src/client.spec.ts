import net from "net"
import chai, { expect } from "chai"
import chaiAsPromised from "chai-as-promised"
import * as subject from "./client"

describe("Message queue client functions", () => {
  let mockServer: net.Server
  let mockOnConnection: (socket: net.Socket) => void = (_) => {}

  before(async () => {
    chai.use(chaiAsPromised)
    mockServer = await new Promise((resolve) => {
      const server = net.createServer((socket) => {
        mockOnConnection(socket)
      })
      server.listen(8080, "127.0.0.1")
      resolve(server)
    })
  })

  after(() => {
    mockServer.close()
  })

  describe("getMessageQueue", () => {
    it("should return a MessageQueue object if a message queue server is reachable", async () => {
      const queue = await subject.getMessageQueue("localhost", 8080)
      expect(queue.active).to.eql(true)
    })

    it("should throw an error if no server is reachable at host:port", async () => {
      expect(subject.getMessageQueue("something", 1337)).to.be.rejectedWith(
        Error
      )
    })
  })

  describe("closeMessageQueue", () => {
    it("should return a MessageQueue object where active=false", async () => {
      const queue = await subject.getMessageQueue("localhost", 8080)
      const queue2 = subject.closeMessageQueue(queue)

      expect(queue2.active).to.eql(false)
    })

    it("should send an 'END' message to the message queue server", async () => {
      await new Promise(async (resolve) => {
        mockOnConnection = (socket) => {
          socket.on("data", function (data) {
            expect(data.toString()).to.eql("END")
            resolve()
          })
        }

        const queue = await subject.getMessageQueue("localhost", 8080)
        subject.closeMessageQueue(queue)
      })
    })
  })
})
