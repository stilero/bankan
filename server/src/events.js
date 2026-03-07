import { EventEmitter } from 'node:events';

const bus = new EventEmitter();
bus.setMaxListeners(50);

export default bus;
