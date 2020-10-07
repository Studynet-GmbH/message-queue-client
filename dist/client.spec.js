"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const net_1 = __importDefault(require("net"));
const chai_1 = __importStar(require("chai"));
const chai_as_promised_1 = __importDefault(require("chai-as-promised"));
const subject = __importStar(require("./client"));
const client_assets_spec_1 = require("./client.assets.spec");
describe("Message queue client functions", () => {
    let mockServer;
    let mockOnConnection = (_) => { };
    let connections = [];
    before(() => __awaiter(void 0, void 0, void 0, function* () {
        chai_1.default.use(chai_as_promised_1.default);
        mockServer = yield new Promise((resolve) => {
            const server = net_1.default.createServer((socket) => {
                connections.push(socket);
                mockOnConnection(socket);
            });
            server.listen(8080, "127.0.0.1");
            resolve(server);
        });
    }));
    after(() => {
        mockServer.close();
        connections.forEach((socket) => {
            socket.destroy();
        });
    });
    describe("getMessageQueue", () => {
        it("should return a MessageQueue object if a message queue server is reachable", () => __awaiter(void 0, void 0, void 0, function* () {
            const queue = yield subject.getMessageQueue("localhost", 8080);
            chai_1.expect(queue.active).to.eql(true);
        }));
        it("should throw an error if no server is reachable at host:port", () => __awaiter(void 0, void 0, void 0, function* () {
            chai_1.expect(subject.getMessageQueue("something", 1337)).to.be.rejectedWith(Error);
        }));
    });
    describe("closeMessageQueue", () => {
        it("should return a MessageQueue object where active=false", () => __awaiter(void 0, void 0, void 0, function* () {
            const queue = yield subject.getMessageQueue("localhost", 8080);
            const queue2 = subject.closeMessageQueue(queue);
            chai_1.expect(queue2.active).to.eql(false);
        }));
        it("should send an 'END' message to the message queue server", () => __awaiter(void 0, void 0, void 0, function* () {
            yield new Promise((resolve) => __awaiter(void 0, void 0, void 0, function* () {
                mockOnConnection = (socket) => {
                    socket.on("data", function (data) {
                        chai_1.expect(data.toString()).to.eql("END");
                        resolve();
                    });
                };
                const queue = yield subject.getMessageQueue("localhost", 8080);
                subject.closeMessageQueue(queue);
            }));
        })).timeout(5000);
    });
    describe("getTask", () => {
        it("should send an 'ASK' message to the server", () => __awaiter(void 0, void 0, void 0, function* () {
            yield new Promise((resolve) => __awaiter(void 0, void 0, void 0, function* () {
                mockOnConnection = (socket) => {
                    socket.on("data", function (data) {
                        chai_1.expect(data.toString().trim()).to.eql("ASK");
                        resolve();
                    });
                };
                const queue = yield subject.getMessageQueue("localhost", 8080);
                yield subject.getTask(queue);
            }));
        })).timeout(5000);
        it("should send an 'ASK [queue]' message to the server, if the 'from' parameter is supplied", () => __awaiter(void 0, void 0, void 0, function* () {
            const testQueueName = "TEST";
            yield new Promise((resolve) => __awaiter(void 0, void 0, void 0, function* () {
                mockOnConnection = (socket) => {
                    socket.on("data", function (data) {
                        chai_1.expect(data.toString().trim()).to.eql(`ASK ${testQueueName}`);
                        resolve();
                    });
                };
                const queue = yield subject.getMessageQueue("localhost", 8080);
                yield subject.getTask(queue, testQueueName);
            }));
        })).timeout(5000);
        it("should return a task object if the server has data available", () => __awaiter(void 0, void 0, void 0, function* () {
            const testTask = "this is a sample task";
            mockOnConnection = (socket) => {
                socket.on("data", function (_data) {
                    socket.write(`WANT? ${testTask}`);
                });
            };
            const queue = yield subject.getMessageQueue("localhost", 8080);
            const task = yield subject.getTask(queue);
            chai_1.expect(task).to.have.property("data", testTask);
        }));
        it("should return null if the message queue does not have any tasks", () => __awaiter(void 0, void 0, void 0, function* () {
            mockOnConnection = (socket) => {
                socket.on("data", (_data) => {
                    socket.write("NOPE");
                });
            };
            const queue = yield subject.getMessageQueue("localhost", 8080);
            const task = yield subject.getTask(queue);
            chai_1.expect(task).to.be.null;
        }));
        it("should receive long tasks fully", () => __awaiter(void 0, void 0, void 0, function* () {
            mockOnConnection = (socket) => {
                socket.on("data", (_data) => {
                    socket.write("WANT? " + client_assets_spec_1.taskExample);
                });
            };
            const queue = yield subject.getMessageQueue("localhost", 8080);
            const task = yield subject.getTask(queue);
            chai_1.expect(task).to.have.property("data", client_assets_spec_1.taskExample);
        }));
        it("should return null if json mode is enabled and the received task is not valid json", () => __awaiter(void 0, void 0, void 0, function* () {
            const exampleTask = "notJson";
            mockOnConnection = (socket) => {
                socket.on("data", (_data) => {
                    socket.write("WANT? " + exampleTask);
                });
            };
            const queue = yield subject.getMessageQueue("localhost", 8080, true);
            const task = yield subject.getTask(queue);
            chai_1.expect(task).to.be.null;
        }));
        it("should return an object if json mode is enabled and the received task IS valid json", () => __awaiter(void 0, void 0, void 0, function* () {
            const exampleTask = {
                test: "test",
                test2: 1,
            };
            mockOnConnection = (socket) => {
                socket.on("data", (_data) => {
                    socket.write("WANT? " + JSON.stringify(exampleTask));
                });
            };
            const queue = yield subject.getMessageQueue("localhost", 8080, true);
            const task = yield subject.getTask(queue);
            chai_1.expect(task).to.not.be.null;
            chai_1.expect(task === null || task === void 0 ? void 0 : task.data).to.be.an("object");
        }));
        it("should reconnect if the message queue is set to active=false", () => __awaiter(void 0, void 0, void 0, function* () {
            mockOnConnection = (socket) => {
                socket.on("data", (_data) => {
                    socket.write("WANT? test");
                });
            };
            const queue = yield subject.getMessageQueue("localhost", 8080);
            const closedQueue = subject.closeMessageQueue(queue);
            const task = yield subject.getTask(closedQueue);
            chai_1.expect(task).to.not.be.null;
        }));
        it("should reconnect if the message queue connection timed out", () => __awaiter(void 0, void 0, void 0, function* () {
            mockOnConnection = (socket) => {
                socket.on("data", (_data) => {
                    socket.write("WANT? test");
                });
            };
            const queue = yield subject.getMessageQueue("localhost", 8080);
            queue.client.destroy();
            const task = yield subject.getTask(queue);
            chai_1.expect(task).to.not.be.null;
        }));
        it("should throw an error if the server could not be reached after two attempts", () => __awaiter(void 0, void 0, void 0, function* () {
            let testServer;
            yield new Promise((resolve) => {
                testServer = net_1.default.createServer();
                testServer.listen({ port: 7070, host: "localhost" }, () => {
                    resolve();
                });
            });
            const queue = yield subject.getMessageQueue("localhost", 7070);
            queue.client.destroy();
            yield new Promise((resolve) => {
                testServer.close((_) => {
                    resolve();
                });
            });
            chai_1.expect(subject.getTask(queue)).to.be.rejectedWith(Error);
        }));
    });
    describe("scheduleTask", () => __awaiter(void 0, void 0, void 0, function* () {
        it("should send a SCHED message to the server", () => __awaiter(void 0, void 0, void 0, function* () {
            const testTask = "test";
            yield new Promise((resolve) => __awaiter(void 0, void 0, void 0, function* () {
                mockOnConnection = (socket) => {
                    socket.on("data", function (data) {
                        chai_1.expect(data.toString().trim()).to.eql(`SCHED ${testTask}`);
                        resolve();
                    });
                };
                const queue = yield subject.getMessageQueue("localhost", 8080);
                yield subject.scheduleTask(queue, testTask, null);
            }));
        })).timeout(5000);
        it("should send a SCHED [@queue] message if the 'forQueue' parameter is supplied", () => __awaiter(void 0, void 0, void 0, function* () {
            const testTask = "test";
            const testQueue = "queue";
            yield new Promise((resolve) => __awaiter(void 0, void 0, void 0, function* () {
                mockOnConnection = (socket) => {
                    socket.on("data", function (data) {
                        chai_1.expect(data.toString().trim()).to.eql(`SCHED ${testTask}@${testQueue}`);
                        resolve();
                    });
                };
                const queue = yield subject.getMessageQueue("localhost", 8080);
                yield subject.scheduleTask(queue, testTask, testQueue);
            }));
        })).timeout(5000);
        it("should correctly encode the task if an object was passed", () => __awaiter(void 0, void 0, void 0, function* () {
            const testTask = {
                test1: "test",
                test2: 1,
                test3: true,
            };
            yield new Promise((resolve) => __awaiter(void 0, void 0, void 0, function* () {
                mockOnConnection = (socket) => {
                    socket.on("data", function (data) {
                        chai_1.expect(data.toString().trim()).to.eql(`SCHED ${JSON.stringify(testTask)}`);
                        resolve();
                    });
                };
                const queue = yield subject.getMessageQueue("localhost", 8080);
                yield subject.scheduleTask(queue, testTask, null);
            }));
        })).timeout(5000);
        it("should reconnect if the message queue is set to active=false", () => __awaiter(void 0, void 0, void 0, function* () {
            yield new Promise((resolve) => __awaiter(void 0, void 0, void 0, function* () {
                mockOnConnection = (socket) => {
                    socket.on("data", function (_data) {
                        // only end the test if the client sent data
                        resolve();
                    });
                };
                const testTask = "test";
                const queue = yield subject.getMessageQueue("localhost", 8080);
                const closedQueue = subject.closeMessageQueue(queue);
                yield subject.scheduleTask(closedQueue, testTask, null);
            }));
        })).timeout(5000);
        it("should reconnect if the message queue connection timed out", () => __awaiter(void 0, void 0, void 0, function* () {
            yield new Promise((resolve) => __awaiter(void 0, void 0, void 0, function* () {
                mockOnConnection = (socket) => {
                    socket.on("data", function (_data) {
                        resolve();
                    });
                };
                const testTask = "test";
                const queue = yield subject.getMessageQueue("localhost", 8080);
                queue.client.destroy();
                yield subject.scheduleTask(queue, testTask, null);
            }));
        })).timeout(5000);
        it("should throw an error if the server could not be reached after two attempts", () => __awaiter(void 0, void 0, void 0, function* () {
            let testServer;
            yield new Promise((resolve) => {
                testServer = net_1.default.createServer();
                testServer.listen({ port: 7070, host: "localhost" }, () => {
                    resolve();
                });
            });
            const queue = yield subject.getMessageQueue("localhost", 7070);
            queue.client.destroy();
            yield new Promise((resolve) => {
                testServer.close((_) => {
                    resolve();
                });
            });
            chai_1.expect(subject.scheduleTask(queue, "task", null)).to.be.rejectedWith(Error);
        }));
        it("should throw an error if json mode is enabled and the passed task is not an object", () => __awaiter(void 0, void 0, void 0, function* () {
            const queue = yield subject.getMessageQueue("localhost", 8080, true);
            chai_1.expect(subject.scheduleTask(queue, "task", null)).to.be.rejectedWith(Error);
        }));
    }));
    describe("declineLastTask", () => {
        it("should send a DCL message to the server", () => __awaiter(void 0, void 0, void 0, function* () {
            yield new Promise((resolve) => __awaiter(void 0, void 0, void 0, function* () {
                mockOnConnection = (socket) => {
                    socket.on("data", function (data) {
                        chai_1.expect(data.toString().trim()).to.eql("DCL");
                        resolve();
                    });
                };
                const queue = yield subject.getMessageQueue("localhost", 8080);
                subject.declineLastTask(queue);
            }));
        }));
        it("should call the error callback if supplied and an error occurred", () => __awaiter(void 0, void 0, void 0, function* () {
            const queue = yield subject.getMessageQueue("localhost", 8080);
            queue.client.destroy();
            yield new Promise((resolve) => {
                subject.declineLastTask(queue, () => {
                    resolve();
                });
            });
        })).timeout(5000);
    });
    describe("acceptLastTask", () => {
        it("should send an ACK message to the server", () => __awaiter(void 0, void 0, void 0, function* () {
            yield new Promise((resolve) => __awaiter(void 0, void 0, void 0, function* () {
                mockOnConnection = (socket) => {
                    socket.on("data", function (data) {
                        chai_1.expect(data.toString().trim()).to.eql("ACK");
                        resolve();
                    });
                };
                const queue = yield subject.getMessageQueue("localhost", 8080);
                subject.acceptLastTask(queue);
            }));
        }));
        it("should call the error callback if supplied and an error occurred", () => __awaiter(void 0, void 0, void 0, function* () {
            const queue = yield subject.getMessageQueue("localhost", 8080);
            queue.client.destroy();
            yield new Promise((resolve) => {
                subject.acceptLastTask(queue, () => {
                    resolve();
                });
            });
        })).timeout(5000);
    });
});
//# sourceMappingURL=client.spec.js.map