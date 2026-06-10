import { http } from '../utils/http.js';

export async function login(user: string): Promise<void> {
  await http.post('/login', { user });
}
