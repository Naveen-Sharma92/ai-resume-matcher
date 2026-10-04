/**
 * Thin fetch wrapper around api-service.
 *
 * The access token lives in memory + localStorage and is refreshed once on a
 * 401 before the original request is replayed, so a 15-minute access token
 * never interrupts a user mid-session.
 */
const BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
const API = `${BASE_URL}/api/v1`;

const TOKEN_KEY = 'arm.accessToken';
const REFRESH_KEY = 'arm.refreshToken';

export const tokenStore = {
  get access() {
    return localStorage.getItem(TOKEN_KEY);
  },
  get refresh() {
    return localStorage.getItem(REFRESH_KEY);
  },
  set({ accessToken, refreshToken }) {
    if (accessToken) localStorage.setItem(TOKEN_KEY, accessToken);
    if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

export class ApiRequestError extends Error {
  constructor(message, { status, errors = [] } = {}) {
    super(message);
    this.status = status;
    this.errors = errors;
  }
}

const parse = async (response) => {
  const text = await response.text();
  const json = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new ApiRequestError(json.message || `Request failed (${response.status})`, {
      status: response.status,
      errors: json.errors ?? [],
    });
  }
  return json.data ?? json;
};

const refreshAccessToken = async () => {
  const refreshToken = tokenStore.refresh;
  if (!refreshToken) throw new ApiRequestError('Session expired', { status: 401 });

  const response = await fetch(`${API}/users/refresh-token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ refreshToken }),
  });
  const data = await parse(response);
  tokenStore.set(data);
  return data.accessToken;
};

const request = async (path, { method = 'GET', body, isForm = false, retry = true } = {}) => {
  const headers = {};
  if (!isForm) headers['content-type'] = 'application/json';
  const token = tokenStore.access;
  if (token) headers.authorization = `Bearer ${token}`;

  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    credentials: 'include',
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
  });

  if (response.status === 401 && retry && tokenStore.refresh) {
    await refreshAccessToken();
    return request(path, { method, body, isForm, retry: false });
  }

  return parse(response);
};

export const api = {
  register: (payload) => request('/users/register', { method: 'POST', body: payload }),
  login: (payload) => request('/users/login', { method: 'POST', body: payload }),
  logout: () => request('/users/logout', { method: 'POST' }),
  currentUser: () => request('/users/current-user'),

  createMatch: ({ file, jobDescription, title, company }) => {
    const form = new FormData();
    form.append('resume', file);
    form.append('jobDescription', jobDescription);
    if (title) form.append('title', title);
    if (company) form.append('company', company);
    return request('/matches', { method: 'POST', body: form, isForm: true });
  },

  matchStatus: (id) => request(`/matches/${id}/status`),
  matchResult: (id) => request(`/matches/${id}`),
  listMatches: (page = 1) => request(`/matches?page=${page}&limit=20`),
};

export default api;
