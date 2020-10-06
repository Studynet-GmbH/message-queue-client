import net from "net"
import chai, { expect } from "chai"
import chaiAsPromised from "chai-as-promised"
import * as subject from "./client"
import { taskExample } from "./client.assets.spec"

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
    }).timeout(5000)
  })

  describe("getTask", () => {
    it("should send an 'ASK' message to the server", async () => {
      await new Promise(async (resolve) => {
        mockOnConnection = (socket) => {
          socket.on("data", function (data) {
            expect(data.toString().trim()).to.eql("ASK")
            resolve()
          })
        }

        const queue = await subject.getMessageQueue("localhost", 8080)
        await subject.getTask(queue)
      })
    }).timeout(5000)

    it("should send an 'ASK [queue]' message to the server, if the 'from' parameter is supplied", async () => {
      const testQueueName = "TEST"
      await new Promise(async (resolve) => {
        mockOnConnection = (socket) => {
          socket.on("data", function (data) {
            expect(data.toString().trim()).to.eql(`ASK ${testQueueName}`)
            resolve()
          })
        }

        const queue = await subject.getMessageQueue("localhost", 8080)
        await subject.getTask(queue, testQueueName)
      })
    }).timeout(5000)

    it("should return a task object if the server has data available", async () => {
      const testTask = "this is a sample task"
      mockOnConnection = (socket) => {
        socket.on("data", function (_data) {
          socket.write(`WANT? ${testTask}`)
        })
      }

      const queue = await subject.getMessageQueue("localhost", 8080)
      const task = await subject.getTask(queue)

      expect(task).to.have.property("data", testTask)
    })

    it("should return null if the message queue does not have any tasks", async () => {
      mockOnConnection = (socket) => {
        socket.on("data", (_data) => {
          socket.write("NOPE")
        })
      }

      const queue = await subject.getMessageQueue("localhost", 8080)
      const task = await subject.getTask(queue)

      expect(task).to.be.null
    })

    it("should receive long tasks fully", async () => {
      mockOnConnection = (socket) => {
        socket.on("data", (_data) => {
          socket.write("WANT? " + taskExample)
        })
      }

      const queue = await subject.getMessageQueue("localhost", 8080)
      const task = await subject.getTask(queue)

      expect(task).to.have.property("data", taskExample)
    })

    it("should reconnect if the message queue is set to active=false", async () => {
      mockOnConnection = (socket) => {
        socket.on("data", (_data) => {
          socket.write("WANT? test")
        })
      }

      const queue = await subject.getMessageQueue("localhost", 8080)
      const closedQueue = subject.closeMessageQueue(queue)

      const task = await subject.getTask(closedQueue)
      expect(task).to.not.be.null
    })

    it("should reconnect if the message queue connection timed out", async () => {
      mockOnConnection = (socket) => {
        socket.on("data", (_data) => {
          socket.write("WANT? test")
        })
      }

      const queue = await subject.getMessageQueue("localhost", 8080)
      queue.client.destroy()

      const task = await subject.getTask(queue)
      expect(task).to.not.be.null
    })

    it("should throw an error if the server could not be reached after two attempts", async () => {
      let testServer: net.Server
      await new Promise((resolve) => {
        testServer = net.createServer()
        testServer.listen({ port: 7070, host: "localhost" }, () => {
          resolve()
        })
      })

      const queue = await subject.getMessageQueue("localhost", 7070)
      queue.client.destroy()

      await new Promise((resolve) => {
        testServer.close((_) => {
          resolve()
        })
      })

      expect(subject.getTask(queue)).to.be.rejectedWith(Error)
    })
  })

  describe("scheduleTask", async () => {
    it("should send a SCHED message to the server", async () => {
      const testTask = "test"
      await new Promise(async (resolve) => {
        mockOnConnection = (socket) => {
          socket.on("data", function (data) {
            expect(data.toString().trim()).to.eql(`SCHED ${testTask}`)
            resolve()
          })
        }

        const queue = await subject.getMessageQueue("localhost", 8080)
        await subject.scheduleTask(queue, testTask, null)
      })
    }).timeout(5000)

    it("should send a SCHED [@queue] message if the 'forQueue' parameter is supplied", async () => {
      const testTask = "test"
      const testQueue = "queue"
      await new Promise(async (resolve) => {
        mockOnConnection = (socket) => {
          socket.on("data", function (data) {
            expect(data.toString().trim()).to.eql(
              `SCHED ${testTask}@${testQueue}`
            )
            resolve()
          })
        }

        const queue = await subject.getMessageQueue("localhost", 8080)
        await subject.scheduleTask(queue, testTask, testQueue)
      })
    }).timeout(5000)

    it("should correctly encode the task if an object was passed", async () => {
      const testTask = {
        test1: "test",
        test2: 1,
        test3: true,
      }
      await new Promise(async (resolve) => {
        mockOnConnection = (socket) => {
          socket.on("data", function (data) {
            expect(data.toString().trim()).to.eql(
              `SCHED ${JSON.stringify(testTask)}`
            )
            resolve()
          })
        }

        const queue = await subject.getMessageQueue("localhost", 8080)
        await subject.scheduleTask(queue, testTask, null)
      })
    }).timeout(5000)

    it("should reconnect if the message queue is set to active=false", async () => {
      await new Promise(async (resolve) => {
        mockOnConnection = (socket) => {
          socket.on("data", function (_data) {
            // only end the test if the client sent data
            resolve()
          })
        }

        const testTask = "test"
        const queue = await subject.getMessageQueue("localhost", 8080)
        const closedQueue = subject.closeMessageQueue(queue)

        await subject.scheduleTask(closedQueue, testTask, null)
      })
    }).timeout(5000)

    it("should reconnect if the message queue connection timed out", async () => {
      await new Promise(async (resolve) => {
        mockOnConnection = (socket) => {
          socket.on("data", function (_data) {
            resolve()
          })
        }

        const testTask = "test"
        const queue = await subject.getMessageQueue("localhost", 8080)
        queue.client.destroy()

        await subject.scheduleTask(queue, testTask, null)
      })
    }).timeout(5000)

    it("should throw an error if the server could not be reached after two attempts", async () => {
      let testServer: net.Server
      await new Promise((resolve) => {
        testServer = net.createServer()
        testServer.listen({ port: 7070, host: "localhost" }, () => {
          resolve()
        })
      })

      const queue = await subject.getMessageQueue("localhost", 7070)
      queue.client.destroy()

      await new Promise((resolve) => {
        testServer.close((_) => {
          resolve()
        })
      })

      expect(subject.scheduleTask(queue, "task", null)).to.be.rejectedWith(
        Error
      )
    })
  })

  describe("declineLastTask", () => {
    it("should send a DCL message to the server", async () => {
      await new Promise(async (resolve) => {
        mockOnConnection = (socket) => {
          socket.on("data", function (data) {
            expect(data.toString().trim()).to.eql("DCL")
            resolve()
          })
        }

        const queue = await subject.getMessageQueue("localhost", 8080)
        subject.declineLastTask(queue)
      })
    })

    it("should call the error callback if supplied and an error occurred", async () => {
      const queue = await subject.getMessageQueue("localhost", 8080)
      queue.client.destroy()

      await new Promise((resolve) => {
        subject.declineLastTask(queue, () => {
          resolve()
        })
      })
    }).timeout(5000)
  })

  describe("acceptLastTask", () => {
    it("should send an ACK message to the server", async () => {
      await new Promise(async (resolve) => {
        mockOnConnection = (socket) => {
          socket.on("data", function (data) {
            expect(data.toString().trim()).to.eql("ACK")
            resolve()
          })
        }

        const queue = await subject.getMessageQueue("localhost", 8080)
        subject.acceptLastTask(queue)
      })
    })

    it("should call the error callback if supplied and an error occurred", async () => {
      const queue = await subject.getMessageQueue("localhost", 8080)
      queue.client.destroy()

      await new Promise((resolve) => {
        subject.acceptLastTask(queue, () => {
          console.log("ERROR")
          resolve()
        })
      })
    }).timeout(5000)
  })
})
