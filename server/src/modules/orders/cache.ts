export class RequestCache {
  entries = {};

  get(key) {
    return this.entries[key];
  }

  set(key, value) {
    this.entries[key] = value;
  }
}
