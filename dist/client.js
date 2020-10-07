"use strict";
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
exports.declineLastTask = exports.acceptLastTask = exports.scheduleTask = exports.rescheduleTask = exports.getTask = exports.closeMessageQueue = exports.getMessageQueue = void 0;
const net_1 = __importDefault(require("net"));
const sleep_promise_1 = __importDefault(require("sleep-promise"));
/**
 * Creates a MessageQueue object which represents a tcp connection to the message queue server.
 *
 * @param host - the hostname of a running message queue server
 * @param port - the corresponding port
 * @param jsonMode - when set to true only accepts and returns json objects as tasks
 *
 * @returns the readonly MessageQueue object
 */
function getMessageQueue(host, port, jsonMode = false) {
    return __awaiter(this, void 0, void 0, function* () {
        const client = new net_1.default.Socket();
        const queue = {
            host: host,
            port: port,
            client: client,
            active: false,
            jsonMode: jsonMode,
        };
        return new Promise((resolve, reject) => {
            client.on("error", (error) => {
                reject(new Error(error.toString()));
            });
            client.connect(port, host, () => {
                queue.active = true;
                resolve(queue);
            });
        });
    });
}
exports.getMessageQueue = getMessageQueue;
/**
 * Closes the message queue by sending an END message to the server
 *
 * @param queue - the message queue object of the connection you want to close
 *
 * @returns a MessageQueue object representing the changes
 */
function closeMessageQueue(queue) {
    queue.client.write("END");
    return {
        host: queue.host,
        port: queue.port,
        client: queue.client,
        active: false,
        jsonMode: queue.jsonMode,
    };
}
exports.closeMessageQueue = closeMessageQueue;
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
function getTask(queue, from = "", refreshConnection = false) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!queue.active || refreshConnection) {
            queue = yield getMessageQueue(queue.host, queue.port);
        }
        const task = {
            parent: queue,
            data: "",
        };
        return new Promise((resolve, reject) => {
            // register listeners for relevant events
            registerOneTimeEvents({
                socket: queue.client,
                data: (data) => {
                    const regex = /WANT\? (.+)/;
                    const match = regex.exec(data.toString());
                    if (match != null) {
                        task.data = match[1];
                        if (queue.jsonMode) {
                            try {
                                task.data = JSON.parse(task.data);
                            }
                            catch (err) {
                                resolve(null);
                                return;
                            }
                        }
                        resolve(task);
                    }
                    else {
                        resolve(null);
                    }
                },
                error: (error) => __awaiter(this, void 0, void 0, function* () {
                    if (!refreshConnection) {
                        // if this isnt already the second attempt, try again.
                        // we try twice because the connection may have timed out. If the connection
                        // fails again, we assume that the server is not reachable and throw an error.
                        try {
                            const task = yield getTask(queue, from, true);
                            resolve(task);
                        }
                        catch (error) {
                            reject(error);
                        }
                    }
                    else {
                        reject(error);
                    }
                }),
            });
            // send ASK message
            const message = `ASK ${from}`;
            queue.client.write(message);
        });
    });
}
exports.getTask = getTask;
/**
 * Reschedules a task.
 *
 * @param task - the task you want to reschedule
 */
function rescheduleTask(task) {
    var _a;
    return __awaiter(this, void 0, void 0, function* () {
        yield scheduleTask(task.parent, task.data, (_a = task.origin) !== null && _a !== void 0 ? _a : null);
    });
}
exports.rescheduleTask = rescheduleTask;
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
function scheduleTask(queue, task, forQueue, timeout = 1000, refreshConnection = false) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!queue.active || refreshConnection) {
            queue = yield getMessageQueue(queue.host, queue.port);
        }
        return new Promise((resolve, reject) => __awaiter(this, void 0, void 0, function* () {
            if (queue.jsonMode && typeof task != "object") {
                reject(new Error("Task has to be an object when using jsonMode"));
                return;
            }
            let barrier = false;
            // register listeners for relevant events
            registerOneTimeEvents({
                socket: queue.client,
                error: (error) => __awaiter(this, void 0, void 0, function* () {
                    barrier = true;
                    if (!refreshConnection) {
                        // if this isnt already the second attempt, try again.
                        // we try twice because the connection may have timed out. If the connection
                        // fails again, we assume that the server is not reachable and throw an error.
                        try {
                            const q = yield scheduleTask(queue, task, forQueue, timeout, true);
                            resolve(q);
                        }
                        catch (error) {
                            reject(error);
                        }
                    }
                    else {
                        reject(error);
                    }
                }),
            });
            if (typeof task == "object") {
                task = JSON.stringify(task);
            }
            // send SCHED message
            const message = forQueue != null ? `SCHED ${task}@${forQueue}` : `SCHED ${task}`;
            queue.client.write(message);
            if (!refreshConnection) {
                // wait for potential errors
                yield sleep_promise_1.default(timeout);
            }
            // barrier is true if an error occurred
            if (barrier) {
                return;
            }
            resolve(queue);
        }));
    });
}
exports.scheduleTask = scheduleTask;
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
function acceptLastTask(queue, onError = () => { }) {
    // we are a bit limited by the protocol here. We can only accept the last task we received
    // and that only if the tcp connection didn't terminate in between. To work with these
    // limitations, we can pass an optional, error handling callback function.
    registerOneTimeEvents({
        socket: queue.client,
        error: (_) => {
            onError();
        },
    });
    queue.client.write("ACK");
}
exports.acceptLastTask = acceptLastTask;
/**
 * Marks the last task received as declined.
 *
 * @remarks
 * Due to the design of the protocol error handling is difficult. To acknowledge a task, the protocol does not need any
 * metadata and just assumes the last task send over the socket should be acknowledged. If the socket crashes in the
 * meantime, that information is obviously lost. To handle some of those errors, we can supply an onError listener
 * that is called when encountering tcp errors. In this case we could there reschedule the event manually.
 *
 * @param queue - the message queue that supplied the last task
 * @param onError - an optional error handler
 */
function declineLastTask(queue, onError = () => { }) {
    // same limitations as acceptLastTask
    registerOneTimeEvents({
        socket: queue.client,
        error: (_) => {
            onError();
        },
    });
    queue.client.write("DCL");
}
exports.declineLastTask = declineLastTask;
function registerOneTimeEvents({ socket, data = (_) => { }, error = (_) => { }, }) {
    socket.on("data", (p) => {
        data(p);
        // only capture the first data event
        socket.on("data", () => { });
    });
    socket.on("error", (p) => {
        error(p);
        // only capture the first error event
        socket.on("error", () => { });
    });
}
//# sourceMappingURL=client.js.map