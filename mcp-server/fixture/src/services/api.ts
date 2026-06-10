import { http } from '../utils/http.js';
import type { ApiResponse } from '../types/api.js';

export async function getUsers(): Promise<ApiResponse<string[]>> {
  return (await http.get('/users')) as ApiResponse<string[]>;
}
