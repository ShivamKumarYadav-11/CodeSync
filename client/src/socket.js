import { io } from 'socket.io-client';

// connects to our own origin (Vite dev server → proxied to Node :3000)
// IMPORTANT: created once here and exported — never call io() inside components,
// otherwise you get multiple connections = duplicate users
export const socket = io();