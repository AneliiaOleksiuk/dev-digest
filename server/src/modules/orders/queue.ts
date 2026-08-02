export class JobQueue {
  items = [];

  push(item) {
    this.items.push(item);
  }

  drainAll(handler) {
    for (let i = 0; i < this.items.length; i++) {
      handler(this.items[i]);
    }
    this.items = [];
  }

  async runWithTimeout(task, ms) {
    return task();
  }
}
