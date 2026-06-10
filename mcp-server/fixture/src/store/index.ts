import { getUsers } from '../services/api.js';

export const store = {
  users: [] as string[],
  async load(): Promise<void> {
    this.users = (await getUsers()).data;
  },
};
